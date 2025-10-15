package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	pq "github.com/lib/pq"
)

type annotationRecord struct {
	EventID       string          `json:"event_id"`
	Action        string          `json:"action"`
	ProjectID     string          `json:"project_id"`
	ProjectTitle  string          `json:"project_title,omitempty"`
	TaskID        string          `json:"task_id"`
	TaskData      json.RawMessage `json:"task_data,omitempty"`
	Annotation    json.RawMessage `json:"annotation,omitempty"`
	CompletedBy   string          `json:"completed_by,omitempty"`
	SchemaVersion string          `json:"schema_version"`
	Source        string          `json:"source"`
	ReceivedAt    time.Time       `json:"received_at"`
	SourceRef     *sourceRef      `json:"source_ref,omitempty"`
}

type sourceRef struct {
	URL         string `json:"url,omitempty"`
	S3Bucket    string `json:"s3_bucket,omitempty"`
	S3Key       string `json:"s3_key,omitempty"`
	S3VersionID string `json:"s3_version_id,omitempty"`
	Tag         string `json:"tag,omitempty"`
}

func enqueueAnnotation(payload WebhookPayload, cfg *Config) error {
	if db == nil {
		return fmt.Errorf("database not configured")
	}

	record, err := buildAnnotationRecord(payload, cfg.SchemaVersion)
	if err != nil {
		return err
	}

	payloadJSON, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("marshal annotation record: %w", err)
	}

	// Determine routing and vertical
	repo, taskType, vertical := determineTarget(payload, cfg)

	src := extractSourceRef(record)
	srcTag := ""
	if src != nil {
		srcTag = src.Tag
	}
	// Refresh payload to include source_ref if present
	if src != nil {
		record.SourceRef = src
		if b, mErr := json.Marshal(record); mErr == nil {
			payloadJSON = b
		}
	}

	_, err = db.Exec(
		`INSERT INTO stage.annotations_outbox (event_id, project_id, payload, schema_version, target_repo, task_type, vertical, source_tag)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (event_id) DO NOTHING`,
		record.EventID,
		record.ProjectID,
		string(payloadJSON),
		cfg.SchemaVersion,
		repo,
		taskType,
		vertical,
		srcTag,
	)
	if err != nil {
		return fmt.Errorf("insert into annotations_outbox: %w", err)
	}

	return nil
}

func buildAnnotationRecord(payload WebhookPayload, schemaVersion string) (*annotationRecord, error) {
	projectID, ok := toString(payload.Project["id"])
	if !ok || projectID == "" {
		return nil, fmt.Errorf("webhook payload missing project id")
	}

	taskID, _ := toString(payload.Task["id"])

	annotationJSON, err := json.Marshal(payload.Annotation)
	if err != nil {
		return nil, fmt.Errorf("marshal annotation: %w", err)
	}

	taskData := map[string]interface{}{}
	if data, ok := payload.Task["data"]; ok {
		if m, ok := data.(map[string]interface{}); ok {
			taskData = m
		}
	}

	taskDataJSON, err := json.Marshal(taskData)
	if err != nil {
		return nil, fmt.Errorf("marshal task data: %w", err)
	}

	completedBy := extractCompletedBy(payload.Annotation)
	eventID := deriveEventID(payload.Action, payload, projectID, taskID)

	projectTitle, _ := toString(payload.Project["title"])

	rec := &annotationRecord{
		EventID:       eventID,
		Action:        payload.Action,
		ProjectID:     projectID,
		ProjectTitle:  projectTitle,
		TaskID:        taskID,
		TaskData:      json.RawMessage(taskDataJSON),
		Annotation:    json.RawMessage(annotationJSON),
		CompletedBy:   completedBy,
		SchemaVersion: schemaVersion,
		Source:        "label_studio_webhook",
		ReceivedAt:    time.Now().UTC(),
	}
	return rec, nil
}

func extractSourceRef(rec *annotationRecord) *sourceRef {
	// Try to parse task_data for a source URL and S3 bucket/key
	var task map[string]interface{}
	if rec.TaskData != nil {
		_ = json.Unmarshal(rec.TaskData, &task)
	}
	if task == nil {
		task = map[string]interface{}{}
	}
	// Common keys to look for
	candidates := []string{"pdf_url", "url", "file", "image", "s3_url"}
	var urlStr string
	for _, k := range candidates {
		if v, ok := task[k].(string); ok && v != "" {
			urlStr = v
			break
		}
	}
	bkt, key, ver := parseS3FromURL(urlStr)
	if bkt == "" || key == "" {
		// Some LS storages embed bucket/key as separate fields
		if v, ok := task["s3_bucket"].(string); ok {
			bkt = v
		}
		if v, ok := task["s3_key"].(string); ok {
			key = v
		}
		if v, ok := task["s3_version_id"].(string); ok {
			ver = v
		}
	}
	if urlStr == "" && bkt == "" && key == "" {
		return nil
	}
	tag := buildSourceTag(bkt, key, ver)
	return &sourceRef{URL: urlStr, S3Bucket: bkt, S3Key: key, S3VersionID: ver, Tag: tag}
}

func parseS3FromURL(raw string) (bucket, key, version string) {
	if raw == "" {
		return "", "", ""
	}
	// Very tolerant parse for virtual-hosted-style and path-style S3 URLs
	// Examples: https://bucket.s3.amazonaws.com/key, https://s3.amazonaws.com/bucket/key
	// Also supports custom endpoints like https://bucket.s3.us-east-1.amazonaws.com/key
	u, err := url.Parse(raw)
	if err != nil {
		return "", "", ""
	}
	q := u.Query()
	version = q.Get("versionId")
	host := u.Hostname()
	path := strings.TrimPrefix(u.EscapedPath(), "/")
	// virtual-hosted-style: <bucket>.s3.*.amazonaws.com/<key>
	if strings.Contains(host, ".s3") && !strings.HasPrefix(path, "s3/") {
		parts := strings.Split(host, ".")
		if len(parts) > 0 {
			bucket = parts[0]
		}
		key, _ = url.PathUnescape(path)
		return bucket, key, version
	}
	// path-style: s3.*.amazonaws.com/<bucket>/<key>
	if strings.Contains(host, "amazonaws.com") {
		seg := strings.SplitN(path, "/", 2)
		if len(seg) == 2 {
			bucket, _ = url.PathUnescape(seg[0])
			key, _ = url.PathUnescape(seg[1])
			return bucket, key, version
		}
	}
	return "", "", version
}

func buildSourceTag(bucket, key, version string) string {
	if bucket == "" || key == "" {
		return ""
	}
	tag := "s3://" + bucket + "/" + key
	if version != "" {
		tag += "#" + version
	}
	return tag
}

func extractCompletedBy(annotation map[string]interface{}) string {
	if completedBy, ok := annotation["completed_by"].(map[string]interface{}); ok {
		if email, ok := toString(completedBy["email"]); ok {
			return email
		}
		if username, ok := toString(completedBy["username"]); ok {
			return username
		}
	}
	return ""
}

func deriveEventID(action string, payload WebhookPayload, projectID, taskID string) string {
	normalizedAction := strings.ToLower(action)
	if id, ok := toString(payload.Annotation["id"]); ok && id != "" {
		return fmt.Sprintf("%s-%s", normalizedAction, id)
	}
	if uuidValue, ok := toString(payload.Annotation["uuid"]); ok && uuidValue != "" {
		return fmt.Sprintf("%s-%s", normalizedAction, uuidValue)
	}
	if taskID != "" {
		return fmt.Sprintf("%s-%s-%s", normalizedAction, projectID, taskID)
	}
	return fmt.Sprintf("%s-%s", normalizedAction, newUUID())
}

type outboxRecord struct {
	ID         int64
	ProjectID  string
	TargetRepo string
	Vertical   string
	Payload    json.RawMessage
	CreatedAt  time.Time
	Attempts   int
}

type outboxProcessor struct {
	db            *sql.DB
	cfg           *Config
	hfDefault     *hfClient
	hfClients     map[string]*hfClient
	batchSize     int
	pollInterval  time.Duration
	lockTimeout   time.Duration
	maxAttempts   int
	schemaVersion string
}

func newOutboxProcessor(db *sql.DB, cfg *Config) *outboxProcessor {
	client := newHFClient(cfg.HFRepo, cfg.HFToken, cfg.HFBranch)
	return &outboxProcessor{
		db:            db,
		cfg:           cfg,
		hfDefault:     client,
		hfClients:     map[string]*hfClient{cfg.HFRepo: client},
		batchSize:     cfg.OutboxBatchSize,
		pollInterval:  cfg.OutboxInterval,
		lockTimeout:   cfg.OutboxLockTimeout,
		maxAttempts:   cfg.OutboxMaxAttempts,
		schemaVersion: cfg.SchemaVersion,
	}
}

func (p *outboxProcessor) run(ctx context.Context) {
	ticker := time.NewTicker(p.pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		processed := false
		records, err := p.claimBatch(ctx)
		if err != nil {
			log.Printf("Outbox: claim batch failed: %v", err)
		} else if len(records) > 0 {
			if err := p.flushRecords(ctx, records); err != nil {
				log.Printf("Outbox: flush failed: %v", err)
			}
			processed = true
		}

		if !processed {
			select {
			case <-ticker.C:
			case <-ctx.Done():
				return
			}
		}
	}
}

func (p *outboxProcessor) claimBatch(ctx context.Context) ([]outboxRecord, error) {
	tx, err := p.db.BeginTx(ctx, &sql.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	rows, err := tx.QueryContext(ctx, `
        SELECT id, project_id, COALESCE(target_repo, ''), COALESCE(vertical, ''), payload, created_at, attempts
        FROM stage.annotations_outbox
        WHERE processed_at IS NULL
          AND (locked_at IS NULL OR locked_at < NOW() - ($2 * INTERVAL '1 second'))
        ORDER BY created_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
		p.batchSize,
		int(p.lockTimeout.Seconds()),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []outboxRecord
	for rows.Next() {
		var rec outboxRecord
		if err := rows.Scan(&rec.ID, &rec.ProjectID, &rec.TargetRepo, &rec.Vertical, &rec.Payload, &rec.CreatedAt, &rec.Attempts); err != nil {
			return nil, err
		}
		records = append(records, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(records) == 0 {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return nil, nil
	}

	ids := make([]int64, 0, len(records))
	for _, rec := range records {
		ids = append(ids, rec.ID)
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE stage.annotations_outbox
		SET locked_at = NOW(), attempts = attempts + 1
		WHERE id = ANY($1)`,
		pq.Array(ids),
	); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return records, nil
}

func (p *outboxProcessor) flushRecords(ctx context.Context, records []outboxRecord) error {
	// Group by target_repo then project_id
	repoGroups := make(map[string]map[string][]outboxRecord)
	for _, rec := range records {
		repo := rec.TargetRepo
		if repo == "" {
			repo = p.cfg.HFRepo
		}
		if _, ok := repoGroups[repo]; !ok {
			repoGroups[repo] = make(map[string][]outboxRecord)
		}
		repoGroups[repo][rec.ProjectID] = append(repoGroups[repo][rec.ProjectID], rec)
	}

	for repo, projGroup := range repoGroups {
		client := p.getClient(repo)
		for projectID, recs := range projGroup {
			vertical := recs[0].Vertical
			path := buildShardPath(p.schemaVersion, vertical, projectID, recs[0].CreatedAt)
			payload := buildJSONL(recs)

			ops := []commitOperation{
				{
					Operation: "addOrUpdate",
					Path:      path,
					Content:   base64.StdEncoding.EncodeToString(payload),
				},
			}

			message := fmt.Sprintf("Add %d annotations for project %s (vertical=%s)", len(recs), projectID, vertical)

			if err := client.Commit(ctx, ops, message); err != nil {
				log.Printf("Outbox: commit failed (%s/%s): %v", repo, projectID, err)
				outboxCommitsTotal.WithLabelValues(repo, "error").Inc()
				if updateErr := p.markFailed(ctx, recs, err); updateErr != nil {
					log.Printf("Outbox: mark failed error: %v", updateErr)
				}
				continue
			}

			outboxCommitsTotal.WithLabelValues(repo, "ok").Inc()
			if err := p.markProcessed(ctx, recs, path); err != nil {
				log.Printf("Outbox: mark processed error: %v", err)
			}
		}
	}

	return nil
}

func buildJSONL(records []outboxRecord) []byte {
	var buf bytes.Buffer
	for _, rec := range records {
		buf.Write(rec.Payload)
		buf.WriteByte('\n')
	}
	return buf.Bytes()
}

func buildShardPath(schemaVersion, vertical, projectID string, t time.Time) string {
	ts := t.UTC()
	return fmt.Sprintf(
		"vertical=%s/schema-%s/project-%s/%s/%s/%s/%s/batch-%s.jsonl",
		safePathComponent(vertical),
		safePathComponent(schemaVersion),
		safePathComponent(projectID),
		ts.Format("2006"),
		ts.Format("01"),
		ts.Format("02"),
		ts.Format("15"),
		newUUID(),
	)
}

func safePathComponent(value string) string {
	value = strings.ReplaceAll(value, "/", "-")
	value = strings.ReplaceAll(value, " ", "_")
	if value == "" {
		return "unknown"
	}
	return value
}

func (p *outboxProcessor) markProcessed(ctx context.Context, records []outboxRecord, path string) error {
	ids := make([]int64, 0, len(records))
	for _, rec := range records {
		ids = append(ids, rec.ID)
	}

	_, err := p.db.ExecContext(ctx, `
        UPDATE stage.annotations_outbox
        SET processed_at = NOW(), last_error = NULL, shard_path = $2, locked_at = NULL
        WHERE id = ANY($1)`,
		pq.Array(ids),
		path,
	)
	// Update processed counter by repo (best effort: derive from last record)
	if len(records) > 0 {
		repo := records[len(records)-1].TargetRepo
		if repo == "" {
			repo = p.cfg.HFRepo
		}
		outboxRecordsProcessedTotal.WithLabelValues(repo).Add(float64(len(records)))
	}
	return err
}

func (p *outboxProcessor) markFailed(ctx context.Context, records []outboxRecord, cause error) error {
	ids := make([]int64, 0, len(records))
	for _, rec := range records {
		if p.maxAttempts > 0 && rec.Attempts >= p.maxAttempts {
			log.Printf("Outbox: record %d exceeded max attempts (%d)", rec.ID, p.maxAttempts)
		}
		ids = append(ids, rec.ID)
	}

	errMsg := truncateError(cause, 512)
	_, err := p.db.ExecContext(ctx, `
        UPDATE stage.annotations_outbox
        SET last_error = $2, locked_at = NULL
        WHERE id = ANY($1)`,
		pq.Array(ids),
		errMsg,
	)
	if len(records) > 0 {
		repo := records[len(records)-1].TargetRepo
		if repo == "" {
			repo = p.cfg.HFRepo
		}
		outboxRecordsFailedTotal.WithLabelValues(repo).Add(float64(len(records)))
	}
	return err
}

func truncateError(err error, max int) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	if len(msg) > max {
		return msg[:max]
	}
	return msg
}

func newUUID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("fallback-%d", time.Now().UnixNano())
	}

	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80

	return fmt.Sprintf("%x-%x-%x-%x-%x",
		b[0:4],
		b[4:6],
		b[6:8],
		b[8:10],
		b[10:16],
	)
}

type commitOperation struct {
	Operation string `json:"operation"`
	Path      string `json:"path"`
	Content   string `json:"content"`
}

type hfClient struct {
	repo    string
	token   string
	branch  string
	baseURL string
	http    *http.Client
}

func newHFClient(repo, token, branch string) *hfClient {
	if branch == "" {
		branch = "main"
	}
	return &hfClient{
		repo:    repo,
		token:   token,
		branch:  branch,
		baseURL: "https://huggingface.co",
		http: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c *hfClient) Commit(ctx context.Context, ops []commitOperation, message string) error {
	if c.repo == "" || c.token == "" {
		return fmt.Errorf("huggingface repo or token not configured")
	}

	payload := map[string]interface{}{
		"operations":     ops,
		"commit_message": message,
		"create_pr":      false,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal HF commit payload: %w", err)
	}

	commitURL := fmt.Sprintf("%s/api/datasets/%s/commit/%s",
		c.baseURL,
		url.PathEscape(c.repo),
		url.PathEscape(c.branch),
	)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, commitURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create HF commit request: %w", err)
	}

	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.token))
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("huggingface commit request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("huggingface commit error: status=%d body=%s", resp.StatusCode, string(respBody))
	}

	return nil
}

func (p *outboxProcessor) getClient(repo string) *hfClient {
	if repo == "" || repo == p.cfg.HFRepo {
		return p.hfDefault
	}
	if c, ok := p.hfClients[repo]; ok {
		return c
	}
	c := newHFClient(repo, p.cfg.HFToken, p.cfg.HFBranch)
	p.hfClients[repo] = c
	return c
}

func toString(value interface{}) (string, bool) {
	switch v := value.(type) {
	case nil:
		return "", false
	case string:
		return v, true
	case float64:
		return fmt.Sprintf("%.0f", v), true
	case json.Number:
		return v.String(), true
	default:
		return fmt.Sprintf("%v", v), true
	}
}
