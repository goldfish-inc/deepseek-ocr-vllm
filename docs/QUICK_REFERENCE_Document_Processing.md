# Quick Reference: "What Do I Choose in Label Studio?"

## Short Answer: You Don't Choose!

**Everything happens automatically when you upload a PDF.**

You only interact with the **text entity annotations** (VESSEL, IMO, FLAG, etc.) - tables are processed in the background.

---

## The Complete Flow (Simple Version)

### 1. You Upload a PDF
```
Label Studio → Import → Upload PDF
```

### 2. System Automatically Processes (Both Happen)
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

---

## What You Actually Do (Step by Step)

### Step 1: Upload PDF
- Click "Import" in Label Studio
- Upload your PDF file
- Wait 10-30 seconds (processing time)

### Step 2: Open the Task
- Click on the task card
- You'll see:
  - ✅ Extracted text
  - ✅ Colored boxes (pre-annotations) - **these are ML suggestions**

### Step 3: Review Colored Boxes (Pre-annotations)
Each colored box is a **suggestion** from the ML model:

| Color | Entity Type | Example |
|-------|-------------|---------|
| Blue | VESSEL | "MV Pacific Explorer" |
| Green | IMO | "9876543" |
| Red | FLAG | "Panama" |
| Purple | PORT | "Rotterdam" |
| Orange | DATE | "2024-01-15" |

### Step 4: Accept, Reject, or Add

**For each colored box:**
- ✅ Click to **accept** if correct
- ❌ Click "×" to **reject** if wrong
- ➕ Manually highlight text to **add** missed entities

### Step 5: Submit
- Click "Submit" button
- Your corrections go to the database
- Done!

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

### "Do I need to choose 'extract tables' somewhere?"
❌ **No!** Tables are extracted automatically if they exist in the PDF.

### "Can I turn off table extraction?"
❌ **No!** It always happens. If there are no tables, nothing is extracted.

### "Do I need to choose 'run NER' somewhere?"
❌ **No!** NER (entity detection) always runs automatically.

### "What if I only want tables, not entity detection?"
❌ **Can't do this.** Both always run. Just ignore the entity annotations if you only care about tables.

### "What if I only want entities, not tables?"
✅ **This works automatically!** If there are no tables in the PDF, no tables are extracted. You just work with entity annotations.

---

## Decision Tree (What Actually Requires a Choice)

```
Have a PDF to process?
  │
  ├─ YES → Upload to Label Studio
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
  └─ NO → Nothing to do
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
| **Do I choose between text and tables?** | No - both automatic |
| **What do I see in Label Studio?** | Text with entity highlights only |
| **Where do tables go?** | Directly to database (background) |
| **What's my job?** | Review/correct entity annotations |
| **Do I need to trigger anything?** | No - just upload PDF |
| **Can I see extracted tables?** | No - ask engineering to query DB |
| **What if ML misses entities?** | Manually add them |
| **What if ML gets entities wrong?** | Reject and correct them |

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

---

## Key Takeaway

**You only make ONE choice: Which entity annotations are correct.**

Everything else (extraction, table processing, webhooks) is automatic!
