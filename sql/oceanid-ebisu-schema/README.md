# Ebisu Database - Standalone Package

This package contains everything needed to run the Ebisu marine database system.

## Prerequisites

You only need Docker Desktop installed on your computer:
- **Windows**: Download from https://www.docker.com/products/docker-desktop/
- **Mac**: Download from https://www.docker.com/products/docker-desktop/
- **Linux**: Follow instructions at https://docs.docker.com/engine/install/

## Quick Start Instructions

### 1. Start the Database

Open a terminal/command prompt in this folder and run:

```bash
docker-compose -f docker/docker-compose.yml up -d
```

This will:
- Download PostgreSQL 17
- Create a database named "ebisu"
- Set up all tables and indexes
- Be ready for use in about 30 seconds

### 2. Check if Everything is Running

```bash
docker ps
```

You should see two containers:
- `ebisu-db` - The PostgreSQL database
- `ebisu-importer` - The migration runner

### 3. Connect to the Database

#### Option A: Using Command Line
```bash
docker exec -it ebisu-db psql -U ebisu_user -d ebisu
```

#### Option B: Using a GUI Tool
Use any PostgreSQL client (pgAdmin, DBeaver, TablePlus, etc.) with:
- **Host**: localhost
- **Port**: 5433
- **Database**: ebisu
- **Username**: ebisu_user
- **Password**: ebisu_password

### 4. View Database Structure

Once connected, you can explore the database:

```sql
-- List all tables
\dt

-- See table details
\d species_name_registry

-- Count records in main tables
SELECT 'worms_taxonomic_core' as table_name, COUNT(*) as count FROM worms_taxonomic_core
UNION ALL
SELECT 'itis_taxonomic_units', COUNT(*) FROM itis_taxonomic_units
UNION ALL
SELECT 'asfis_species', COUNT(*) FROM asfis_species;
```

## Database Contents

The Ebisu database includes:

### Reference Data Tables
- `country_iso` - ISO country codes and names
- `country_iso_eu` - EU membership status
- `country_iso_foc` - Flag of Convenience status
- `country_iso_ilo_c188` - ILO C188 Work in Fishing Convention status
- `fao_major_areas` - FAO fishing areas
- `vessel_types` - Vessel type classifications
- `vessel_hull_material` - Hull material types
- `rfmos` - Regional Fisheries Management Organizations

### Gear Type Tables
- `gear_types_fao` - FAO gear classifications
- `gear_types_cbp` - CBP gear classifications
- `gear_types_msc` - MSC gear classifications
- `gear_types_relationship_fao_cbp` - FAO-CBP gear mappings
- `gear_types_relationship_msc_fao` - MSC-FAO gear mappings

### Taxonomic Data Tables
- `worms_taxonomic_core` - World Register of Marine Species (core data)
- `worms_taxonomic_extended` - WoRMS extended metadata
- `itis_taxonomic_units` - Integrated Taxonomic Information System
- `itis_kingdoms` - ITIS kingdom classifications
- `itis_taxon_authors` - ITIS taxonomic authors
- `itis_taxonomic_hierarchy` - ITIS hierarchy relationships
- `asfis_species` - FAO ASFIS species with trade codes

### Integration Tables
- `harmonized_species` - species registry for WoRMS + ASFIS

## Common Operations

### Stop the Database
```bash
docker-compose -f docker/docker-compose.yml down
```

### Stop and Remove All Data
```bash
docker-compose -f docker/docker-compose.yml down -v
```

### View Logs
```bash
docker logs ebisu-db
docker logs ebisu-importer
```

### Backup the Database
```bash
docker exec ebisu-db pg_dump -U ebisu_user ebisu > ebisu_backup.sql
```

### Restore from Backup
```bash
docker exec -i ebisu-db psql -U ebisu_user ebisu < ebisu_backup.sql
```

## Troubleshooting

### Port Already in Use
If you get an error about port 5433 being in use:
1. Change the port in `docker/docker-compose.yml` from `5433:5432` to something else like `5434:5432`
2. Use the new port number when connecting

### Database Won't Start
Check the logs:
```bash
docker logs ebisu-db
```

### Reset Everything
```bash
# Stop and remove everything
docker-compose -f docker/docker-compose.yml down -v

# Start fresh
docker-compose -f docker/docker-compose.yml up -d
```

## Support

If you encounter issues:
1. Check the logs: `docker logs ebisu-db`
2. Ensure Docker Desktop is running
3. Try the reset steps above
4. Make sure no other PostgreSQL is using port 5433

## Data Model Documentation

See the included visualization files:
- `docs/database-diagrams.md` - Complete entity relationship diagrams
- `docs/database-visualization.md` - Data flow and architecture diagrams
- `docs/species-integration-workflow.md` - Species matching workflows

These files contain Mermaid diagrams that can be viewed in any Markdown viewer or pasted into https://mermaid.live/
