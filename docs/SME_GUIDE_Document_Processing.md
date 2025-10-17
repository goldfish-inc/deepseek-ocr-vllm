# SME Guide: How Document Processing Works in Label Studio

## Overview: Two Automatic Processing Paths

When you upload a document to Label Studio, **BOTH** of these happen automatically:

1. **Text Analysis (NER)** - Finds vessel names, IMO numbers, flags, ports, dates
2. **Table Extraction** - Finds and extracts tables from PDFs

You **don't choose** between them - both run automatically on every PDF upload!

---

## What Happens When You Upload a PDF

### Step 1: You Upload the Document
- Go to Label Studio project
- Click "Import" → Upload PDF file
- Label Studio creates a task (gives it a task ID)

### Step 2: ML Backend Processes Automatically
The Triton ML backend (ls-triton-adapter) **automatically** runs:

#### A. Docling Document Extraction
- Extracts all text from the PDF
- Identifies and extracts all tables
- Preserves document structure

#### B. NER (Named Entity Recognition)
- Scans the extracted text for:
  - **VESSEL**: Ship names (e.g., "MV Pacific Explorer")
  - **IMO**: IMO numbers (e.g., "9876543")
  - **FLAG**: Country flags (e.g., "Panama", "Liberia")
  - **PORT**: Port names (e.g., "Rotterdam", "Singapore")
  - **DATE**: Dates (e.g., "2024-01-15")
  - **HS_CODE**: Harmonized System codes
  - **COMMODITY**: Goods/cargo types
  - **RISK_LEVEL**: Risk assessments

#### C. Table Processing (Automatic)
If tables are found:
1. Each table is converted to CSV format
2. Uploaded to S3 storage: `s3://labelstudio-goldfish-uploads/docling-tables/[project]/[task]-table-0.csv`
3. CSV ingestion worker is **automatically notified** via webhook
4. Tables appear in your database for analysis

### Step 3: You Review in Label Studio UI
1. **Text tab**: See extracted text with NER highlights
2. **Pre-annotations**: ML-suggested entities (colored boxes)
3. **Accept/Reject**: Click pre-annotations to accept or reject
4. **Manual correction**: Add missing entities or fix incorrect ones

---

## What You See in the Label Studio UI

### Pre-Annotations (ML Suggestions)
When you open a task, you'll see:
- **Blue boxes** around vessel names
- **Green boxes** around IMO numbers
- **Red boxes** around country flags
- **Purple boxes** around port names
- **Orange boxes** around dates

These are **suggestions** from the ML model - they may be wrong!

### Your Job as SME
1. **Review each highlight**:
   - ✅ Click to accept if correct
   - ❌ Delete if wrong
   - ➕ Add missing entities the ML missed

2. **Tables are handled separately**:
   - You don't see tables in Label Studio UI
   - Tables go directly to the database via CSV worker
   - Check the database or data lake to review extracted tables

---

## Two Different Data Flows

### Flow 1: Text Entities (What You Work With)
```
PDF Upload
  ↓
Triton ML (Docling + NER)
  ↓
Pre-annotations in Label Studio UI ← YOU REVIEW HERE
  ↓
Annotations Sink (when you click Submit)
  ↓
Database (curated annotations table)
```

### Flow 2: Tables (Automatic Background Processing)
```
PDF Upload
  ↓
Triton ML (Docling extracts tables)
  ↓
Tables → S3 as CSV files
  ↓
CSV Ingestion Worker (automatic webhook)
  ↓
Database (raw/stage tables)
```

**Key Point**: You never interact with the table extraction in Label Studio - it happens in the background!

---

## Common Questions

### Q: How do I trigger table extraction?
**A:** You don't! It happens automatically when you upload a PDF. If the PDF contains tables, they're extracted and sent to the CSV worker without any action from you.

### Q: Can I see the extracted tables in Label Studio?
**A:** No. Tables bypass Label Studio and go directly to the database. Check your database or ask data engineering team to query the `raw.docling_tables` table.

### Q: What if the ML model misses entities?
**A:** That's why we need SMEs! Your job is to:
1. Accept correct pre-annotations
2. Delete incorrect pre-annotations
3. **Manually add entities the ML missed**

### Q: Do I need to do anything special for vessel registry documents?
**A:** No. Upload them like any other PDF. The system will:
- Automatically extract text and find entities
- Automatically extract any tables (common in registry docs)
- Show you pre-annotations to review

### Q: What document types work best?
**A:** Any PDF with:
- **Clear text** (not scanned images) - best performance
- **Structured data** (tables, lists) - tables automatically extracted
- **Standard formats** (vessel registries, port records, manifests)

Scanned/image PDFs work but with lower accuracy.

### Q: How do I know if tables were extracted?
**A:** Check the logs or ask engineering to query:
```sql
SELECT * FROM raw.docling_tables
WHERE task_id = [your_task_id];
```

---

## What Each Project Type Needs

### Vessel Registry Documents
- **What ML finds**: Vessel names, IMO numbers, flags, ports
- **Tables extracted**: Vessel lists, registration tables
- **Your focus**: Verify vessel names and IMO numbers are correct

### Port Authority Records
- **What ML finds**: Port names, dates, vessel names
- **Tables extracted**: Movement schedules, cargo manifests
- **Your focus**: Ensure port names and dates are accurate

### Customs/Cargo Documents
- **What ML finds**: HS codes, commodity names, dates
- **Tables extracted**: Cargo lists, duty calculations
- **Your focus**: Verify commodity classifications

---

## Troubleshooting

### "I don't see any pre-annotations"
- Check ML backend is attached: Settings → Machine Learning
- Expected: "Triton NER" backend connected
- If missing: contact engineering

### "Pre-annotations are very wrong"
- This is normal for complex documents
- **Reject incorrect ones** and manually annotate
- Your corrections help improve the model!

### "I can't find the extracted tables"
- Tables don't appear in Label Studio
- They're in the database automatically
- Ask engineering team to query for your task ID

### "The document didn't upload"
- Check file size (max 50MB)
- Ensure it's a PDF (not image file)
- If scanned PDF, may need OCR preprocessing

---

## Summary for SMEs

**What happens automatically:**
1. ✅ Text extraction from PDFs
2. ✅ Entity detection (VESSEL, IMO, FLAG, etc.)
3. ✅ Table extraction and CSV generation
4. ✅ CSV worker processes tables into database

**What you do:**
1. 👀 Review ML pre-annotations
2. ✅ Accept correct ones
3. ❌ Reject incorrect ones
4. ➕ Add missed entities
5. 💾 Submit when done

**What you DON'T need to do:**
- ❌ Trigger table extraction manually
- ❌ Review tables in Label Studio (they go to database)
- ❌ Choose between "text mode" vs "table mode"
- ❌ Configure ML backends (engineering handles this)

---

## Contact

Questions about:
- **Label Studio UI**: Check Label Studio docs or ask project lead
- **ML accuracy issues**: Report examples to ML team
- **Missing tables**: Contact data engineering team
- **Technical errors**: Check with infrastructure team

**Remember**: Your domain expertise is crucial - the ML model needs your corrections to improve!
