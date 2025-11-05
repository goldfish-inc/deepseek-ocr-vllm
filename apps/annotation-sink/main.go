package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Server struct {
	db *pgxpool.Pool
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"ok":true}`))
}

// Label Studio webhook payload (minimal fields used)
type LSWebhook struct {
	Action     string `json:"action"`
	Project    int64  `json:"project"`
	Task       int64  `json:"task"`
	Annotation struct {
		ID        int64 `json:"id"`
		Result    any   `json:"result"`
		CreatedBy any   `json:"created_by"`
	} `json:"annotation"`
	// Include full payload for audit
	Raw json.RawMessage `json:"-"`
}

func (s *Server) webhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	defer r.Body.Close()
	var buf bytes.Buffer
	if _, err := buf.ReadFrom(r.Body); err != nil {
		http.Error(w, "read error", http.StatusBadRequest)
		return
	}
	payload := buf.Bytes()
	var ev LSWebhook
	if err := json.Unmarshal(payload, &ev); err != nil {
		// still store raw
		log.Printf("webhook decode error: %v", err)
	} else {
		ev.Raw = payload
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	// Store raw payload for audit
	_, err := s.db.Exec(ctx,
		`insert into annotations(ls_project_id, ls_task_id, ls_annotation_id, payload, created_at)
         values($1,$2,$3,$4, now())`,
		ev.Project, ev.Task, ev.Annotation.ID, payload,
	)
	if err != nil {
		log.Printf("db insert annotations failed: %v", err)
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}

	// TODO: parse ev.Annotation.Result into canonical fields and write record_versions

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_, _ = w.Write([]byte(`{"status":"accepted"}`))
}

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		log.Fatalf("pgxpool: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		log.Fatalf("db ping: %v", err)
	}
	addr := os.Getenv("LISTEN_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	srv := &Server{db: pool}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", srv.health)
	mux.HandleFunc("/webhook", srv.webhook)
	log.Printf("annotation-sink listening on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}
