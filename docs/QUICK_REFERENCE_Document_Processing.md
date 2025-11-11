> **Archived — November 2025**
>
> **This document describes the deprecated Label Studio workflow.**
>
> **For current pipeline documentation, see:**
> - `docs/operations/pipeline-overview.md` - Current end-to-end flow
> - `docs/architecture/ocr-argilla-motherduck.md` - New architecture
> - `workers/vessel-ner/ARCHITECTURE.md` - Cloudflare Workers design
> - `docs/operations/argilla-auto-discovery.md` - Argilla integration

# (Archived) Quick Reference: "What Do I Choose in Label Studio?"

## Short Answer: It Depends on File Type!

| File Type | What Happens | What You See |
|-----------|--------------|--------------|
| **PDF** | Automatic: Text extraction + NER + Table extraction | Text with entity highlights |
| **CSV/XLSX** | Automatic: Data ingestion + Cleaning rules | Nothing in Label Studio UI* |
| **TSV** | Automatic: Data ingestion + Cleaning rules | Nothing in Label Studio UI* |

This quick reference described the previous Label Studio-centric workflow. The current system does not use Label Studio. CSV/Excel and document processing now flow through services and Triton directly with results available in the database and via PostGraphile.

---

## Supported File Formats

### Documents (For Entity Annotation)
- ✅ **PDF** - Text extraction, entity detection (NER), table extraction

### Spreadsheets (For Data Ingestion)
- ✅ **CSV** (.csv) - Direct database ingestion
- ✅ **TSV** (.tsv) - Tab-separated values
- ✅ **Excel** (.xlsx, .xls) - Microsoft Excel files

**All formats process automatically on upload!**

---

## The Complete Flow (Simple Version)

### PDF Documents (For Entity Annotation)

#### 1. You Upload a PDF
```
Label Studio → Import → Upload PDF
```

#### 2. System Automatically Processes (Both Happen)
```
┌─────────────────────────────────────────────────────┐
│  PDF UPLOAD                                          │
└────────────────┬────────────────────────────────────┘
                 │
                 ├─── Path A: Text & Entities ──────────┐
                 │    (You see and review this)         │
                 │                                       │
                 │    1. Extract text                   │
                 │    2. Find entities (ML)             │
                 │    3. Show as colored boxes          │
                 │    4. YOU review/correct             │
                 │    5. Click Submit                   │
                 │                                       │
                 └─── Path B: Tables ──────────────────┐│
                      (Automatic, you don't see)       ││
                                                        ││
                      1. Extract tables                ││
                      2. Save as CSV to S3             ││
                      3. CSV worker processes          ││
                      4. Goes to database              ││
                                                        ││
                      ↓                                 ↓↓
                 ┌──────────────────────────────────────┐
                 │  DATABASE                             │
                 │  - Text entities (from your review)  │
                 │  - Tables (automatic)                │
                 └──────────────────────────────────────┘
```

### CSV/Excel Files (Direct Data Ingestion)

#### 1. You Upload CSV/XLSX/TSV
```
Label Studio → Import → Upload CSV/Excel file
```

#### 2. System Automatically Processes (No UI Interaction)
```
┌─────────────────────────────────────────────────────┐
│  CSV/EXCEL UPLOAD                                    │
└────────────────┬────────────────────────────────────┘
                 │
                 │    (Everything automatic, nothing to review)
                 │
                 ├─── 1. File uploaded to S3
                 │
                 ├─── 2. CSV worker webhook triggered
                 │
                 ├─── 3. Worker downloads file
                 │
                 ├─── 4. Parses data (CSV/TSV/XLSX/XLS)
                 │
                 ├─── 5. Applies cleaning rules
                 │
                 └─── 6. Inserts into database
                      │
                      ↓
                 ┌──────────────────────────────────────┐
                 │  DATABASE                             │
                 │  - Raw tables (as uploaded)          │
                 │  - Cleaned/staged data               │
                 └──────────────────────────────────────┘
```

**Key Difference**: CSV/Excel files **never appear in Label Studio UI** - they go straight to the database!

---

## What You Actually Do (Step by Step)

### For PDF Documents

#### Step 1: Upload PDF
- Click "Import" in Label Studio
- Upload your PDF file
- Wait 10-30 seconds (processing time)

#### Step 2: Open the Task
- Click on the task card
- You'll see:
  - ✅ Extracted text
  - ✅ Colored boxes (pre-annotations) - **these are ML suggestions**

#### Step 3: Review Colored Boxes (Pre-annotations)
Each colored box is a **suggestion** from the ML model:

| Color | Entity Type | Example |
|-------|-------------|---------|
| Blue | VESSEL | "MV Pacific Explorer" |
| Green | IMO | "9876543" |
| Red | FLAG | "Panama" |
| Purple | PORT | "Rotterdam" |
| Orange | DATE | "2024-01-15" |

#### Step 4: Accept, Reject, or Add

**For each colored box:**
- ✅ Click to **accept** if correct
- ❌ Click "×" to **reject** if wrong
- ➕ Manually highlight text to **add** missed entities

#### Step 5: Submit
- Click "Submit" button
- Your corrections go to the database
- Done!

### For CSV/Excel Files

#### Step 1: Upload CSV/XLSX/TSV
- Click "Import" in Label Studio
- Upload your CSV/Excel file
- File uploads to S3

#### Step 2: Nothing to Do!
**That's it!**
- No task appears in Label Studio UI
- CSV worker processes automatically in background
- Data goes directly to database
- Check database to see ingested data

---

## What About Tables?

### You Don't See Them in Label Studio!

**Tables are handled completely separately:**
- Extracted automatically during Step 2
- Saved as CSV files to S3
- Processed by CSV ingestion worker
- Go directly to database

**To see extracted tables:**
- Ask engineering team to query the database
- Check S3 bucket: `s3://labelstudio-goldfish-uploads/docling-tables/[project]/[task]-table-*.csv`

---

## Common Confusion Clarified

### PDF Documents

#### "Do I need to choose 'extract tables' somewhere?"
❌ **No!** Tables are extracted automatically if they exist in the PDF.

#### "Can I turn off table extraction?"
❌ **No!** It always happens. If there are no tables, nothing is extracted.

#### "Do I need to choose 'run NER' somewhere?"
❌ **No!** NER (entity detection) always runs automatically.

#### "What if I only want tables, not entity detection?"
❌ **Can't do this.** Both always run. Just ignore the entity annotations if you only care about tables.

#### "What if I only want entities, not tables?"
✅ **This works automatically!** If there are no tables in the PDF, no tables are extracted. You just work with entity annotations.

### CSV/Excel Files

#### "Will I see CSV data in Label Studio?"
❌ **No!** CSV/Excel files bypass Label Studio UI entirely. They go directly to the database via CSV ingestion worker.

#### "How do I review CSV uploads?"
✅ **Query the database!** Ask engineering to check `raw.csv_uploads` or relevant staging tables for your data.

#### "Can I annotate entities in CSV files?"
❌ **No!** CSV files are for structured data ingestion only, not entity annotation. Use PDFs if you need entity annotation.

#### "What if my CSV has wrong data?"
✅ **Fix the source file and re-upload.** The CSV worker will process the new upload. Old data may need manual cleanup.

---

## Decision Tree (What Actually Requires a Choice)

```
What file do you have?
  │
  ├─ PDF → Upload to Label Studio
  │         │
  │         ├─ System processes automatically (no choice)
  │         │   ├─ Text extraction: Always
  │         │   ├─ Entity detection: Always
  │         │   └─ Table extraction: If tables exist
  │         │
  │         └─ Your choices:
  │             ├─ Accept pre-annotation? (per entity)
  │             ├─ Reject pre-annotation? (per entity)
  │             ├─ Add missing entities? (manual)
  │             └─ Submit when done
  │
  └─ CSV/XLSX/TSV → Upload to Label Studio
                    │
                    ├─ System processes automatically (no choice)
                    │   ├─ File to S3: Always
                    │   ├─ CSV worker trigger: Always
                    │   └─ Database ingestion: Always
                    │
                    └─ Your choices:
                        └─ NONE! (goes straight to database)
```

---

## Configuration (For Reference - You Don't Touch This)

### What's Already Set Up
- ✅ ML backend connected to all projects
- ✅ Triton server with Docling + NER models
- ✅ CSV ingestion worker configured
- ✅ S3 bucket for table storage
- ✅ Webhooks for automatic processing

### You Don't Need To
- ❌ Configure ML backends (already attached)
- ❌ Set up webhooks (already configured)
- ❌ Choose models (automatic)
- ❌ Trigger processing (automatic on upload)

---

## Summary Card

| Question | Answer |
|----------|--------|
| **Do I choose between text and tables?** | No - both automatic (PDFs) |
| **What do I see in Label Studio?** | PDFs: Text with entity highlights / CSV: Nothing |
| **Where do tables go?** | Directly to database (background) |
| **Where do CSV files go?** | Directly to database (no UI) |
| **What's my job?** | Review/correct entity annotations (PDFs only) |
| **Do I need to trigger anything?** | No - just upload file |
| **Can I see extracted tables?** | No - ask engineering to query DB |
| **Can I see CSV data in UI?** | No - ask engineering to query DB |
| **What if ML misses entities?** | Manually add them (PDFs only) |
| **What if ML gets entities wrong?** | Reject and correct them (PDFs only) |
| **What if CSV has wrong data?** | Fix source file and re-upload |

---

## Examples

### Example 1: Vessel Registry PDF
**What happens:**
1. Upload PDF
2. System extracts:
   - Text: "VESSEL REGISTRY\nMV Pacific Explorer\nIMO: 9876543..."
   - Table: Vessel list with columns [Name, IMO, Flag]
3. You see:
   - Text with blue/green/red boxes
4. You review and submit
5. Tables go to database automatically

### Example 2: Scanned Document (Image PDF)
**What happens:**
1. Upload PDF
2. System extracts:
   - Text: May be poor quality or empty
   - Tables: May not extract well
3. You see:
   - May have few or no pre-annotations
4. You manually annotate entities
5. Submit

### Example 3: Text-Only Document (No Tables)
**What happens:**
1. Upload PDF
2. System extracts:
   - Text: Normal
   - Tables: None found (no error)
3. You see:
   - Text with entity highlights
4. You review and submit
5. No tables sent to CSV worker (nothing to send)

### Example 4: CSV Vessel List
**What happens:**
1. Upload CSV with columns: [Vessel Name, IMO, Flag, Port]
2. File uploads to S3
3. CSV worker webhook triggered automatically
4. Worker parses CSV, inserts rows to database
5. **You see: NOTHING in Label Studio UI**
6. Check database to verify data ingested

### Example 5: Excel Cargo Manifest
**What happens:**
1. Upload XLSX with multiple sheets
2. File uploads to S3
3. CSV worker webhook triggered automatically
4. Worker parses all sheets, inserts to database
5. **You see: NOTHING in Label Studio UI**
6. Check database to verify data from all sheets

---

## Troubleshooting

### "I uploaded PDF but see no annotations"
**Check:**
1. Wait 30 seconds - processing takes time
2. Refresh page
3. Check if ML backend is connected (should be automatic)

### "Tables are missing from database"
**Possible causes:**
1. PDF has no tables
2. Tables are images (can't extract from scanned documents easily)
3. CSV worker failed - check with engineering

### "Pre-annotations are all wrong"
**This is normal!**
- ML model isn't perfect
- Your job is to correct them
- Your corrections improve the model

### "Can I batch upload multiple PDFs?"
**Yes!**
- Use "Import" → "Upload files"
- Select multiple PDFs
- Each gets processed automatically

### "I uploaded CSV but don't see it in Label Studio"
**This is expected!**
- CSV/Excel files don't appear in Label Studio UI
- They go directly to database via CSV ingestion worker
- Check database to verify data was ingested

### "CSV ingestion failed"
**Check with engineering:**
1. Verify CSV worker logs for errors
2. Check file format (valid CSV/TSV/XLSX/XLS)
3. Ensure columns match expected schema
4. Look for malformed rows or encoding issues

### "Can I batch upload CSV files?"
**Yes!**
- Use "Import" → "Upload files"
- Select multiple CSV/Excel files
- Each triggers CSV worker automatically
- All data goes to database in background

---

## Key Takeaway

### For PDFs
**You only make ONE choice: Which entity annotations are correct.**

Everything else (extraction, table processing, webhooks) is automatic!

### For CSV/Excel
**You make ZERO choices!**

Everything is automatic - file uploads, processing, and database ingestion happen in the background with no UI interaction.
> Archived: Superseded by the Argilla + MotherDuck pipeline. See `docs/operations/pipeline-overview.md` and `docs/operations/networking-topology.md`.
