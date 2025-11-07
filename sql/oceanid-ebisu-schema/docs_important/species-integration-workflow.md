# Species Integration Workflow Diagrams

Detailed visualization of how species data flows through the integration system.

## Species Name Normalization Process

```mermaid
flowchart TD
    subgraph "Input Sources"
        W[WoRMS<br/>Carcharodon carcharias<br/>Linnaeus, 1758]
        I[ITIS<br/>Carcharodon carcharias<br/>(Linnaeus, 1758)]
        A[ASFIS<br/>Carcharodon carcharias<br/>WSH - White shark]
    end

    subgraph "Normalization Pipeline"
        W --> N1[normalize_species_name()]
        I --> N1
        A --> N1

        N1 --> S1[Trim whitespace]
        S1 --> S2[Lowercase]
        S2 --> S3[Remove special chars]
        S3 --> S4[Remove suffixes<br/>sp, spp, var]
        S4 --> NR[carcharodon carcharias]
    end

    subgraph "Grouping Key Generation"
        NR --> G1[Extract genus: carcharodon]
        NR --> G2[Extract species: carcharias]
        G1 --> GK[generate_grouping_key()]
        G2 --> GK
        GK --> KEY[carcharodon_carcharias]
    end

    subgraph "Registry Entry"
        KEY --> REG[species_name_registry]
        NR --> REG
        REG --> R1[species_id: uuid]
        REG --> R2[normalized_name: carcharodon carcharias]
        REG --> R3[grouping_key: carcharodon_carcharias]
        REG --> R4[confidence_score: 95.5]
        REG --> R5[match_quality: EXCELLENT]
    end
```

## Multi-Source Matching Algorithm

```mermaid
flowchart LR
    subgraph "Phase 1: Exact Matching"
        E1[WoRMS names] --> EM[Exact Match<br/>normalized = normalized]
        E2[ITIS names] --> EM
        E3[ASFIS names] --> EM
        EM --> |100% confidence| M1[Create mappings]
    end

    subgraph "Phase 2: Synonym Matching"
        S1[WoRMS synonyms] --> SM[Synonym Match<br/>via accepted names]
        S2[ITIS synonyms] --> SM
        SM --> |90% confidence| M2[Create mappings]
    end

    subgraph "Phase 3: Fuzzy Matching"
        F1[Remaining WoRMS] --> FM[Fuzzy Match<br/>similarity > 0.8]
        F2[Remaining ITIS] --> FM
        F3[Remaining ASFIS] --> FM
        FM --> |80% confidence| M3[Create mappings]
    end

    subgraph "Phase 4: Genus Matching"
        G1[Unmatched species] --> GM[Genus Match<br/>same genus only]
        GM --> |60% confidence| M4[Create mappings]
    end

    subgraph "Quality Assignment"
        M1 --> QA[Quality Analysis]
        M2 --> QA
        M3 --> QA
        M4 --> QA

        QA --> Q1[3 sources = EXCELLENT]
        QA --> Q2[2 sources = GOOD]
        QA --> Q3[1 source = FAIR]
        QA --> Q4[Genus only = SINGLE_SOURCE]
    end
```

## ASFIS Multi-Species Handling

```mermaid
flowchart TD
    subgraph "Input Processing"
        CSV[ASFIS CSV Input] --> CHECK{Contains ' x '?}

        CHECK -->|No| SINGLE[Single Species Entry]
        CHECK -->|Yes| MULTI[Multi-Species Entry]

        MULTI --> SPLIT[Split on ' x ']
        SPLIT --> S1[Species 1]
        SPLIT --> S2[Species 2]

        subgraph "Example"
            EX1[Thunnus albacares x T. obesus<br/>YFT - Yellowfin/Bigeye]
            EX1 --> EXS1[Thunnus albacares - YFT]
            EX1 --> EXS2[Thunnus obesus - YFT]
        end
    end

    subgraph "Database Storage"
        SINGLE --> DB1[asfis_species<br/>1 record]
        S1 --> DB2[asfis_species<br/>record 1]
        S2 --> DB3[asfis_species<br/>record 2]

        DB1 --> M1[Same Alpha3 code]
        DB2 --> M1
        DB3 --> M1
    end

    subgraph "Registry Mapping"
        DB1 --> MAP1[Map to species_registry]
        DB2 --> MAP2[Map to species_registry]
        DB3 --> MAP3[Map to species_registry]

        MAP1 --> R1[Species 1 registry entry]
        MAP2 --> R1
        MAP3 --> R2[Species 2 registry entry]
    end
```

## Cascade Trade Code System

```mermaid
flowchart TB
    subgraph "Configuration"
        C1[CASCADE: TUN<br/>Level: FAMILY<br/>Target: Scombridae]
        C2[CASCADE: SCO<br/>Level: GENUS<br/>Target: Scomber]
        C3[CASCADE: CAX<br/>Level: ORDER<br/>Target: Perciformes]
    end

    subgraph "Species Hierarchy"
        F1[Family: Scombridae]
        F1 --> G1[Genus: Thunnus]
        F1 --> G2[Genus: Scomber]
        F1 --> G3[Genus: Katsuwonus]

        G1 --> S1[T. albacares]
        G1 --> S2[T. obesus]
        G1 --> S3[T. alalunga]

        G2 --> S4[S. scombrus]
        G2 --> S5[S. japonicus]

        G3 --> S6[K. pelamis]
    end

    subgraph "Resolution Process"
        C1 --> |Find all Scombridae| R1[Resolve TUN]
        R1 --> |Assign to| AS1[All Thunnus species<br/>All Scomber species<br/>All Katsuwonus species]

        C2 --> |Find all Scomber| R2[Resolve SCO]
        R2 --> |Assign to| AS2[S. scombrus<br/>S. japonicus only]

        C3 --> |Find all Perciformes| R3[Resolve CAX]
        R3 --> |Assign to| AS3[Hundreds of species<br/>across many families]
    end

    subgraph "Storage"
        AS1 --> TCR1[cascade_resolved<br/>6 species × TUN]
        AS2 --> TCR2[cascade_resolved<br/>2 species × SCO]
        AS3 --> TCR3[cascade_resolved<br/>500+ species × CAX]
    end
```

## Confidence Score Calculation

```mermaid
flowchart LR
    subgraph "Base Score Factors"
        F1[Match Type<br/>Exact: 100<br/>Synonym: 90<br/>Fuzzy: 80<br/>Genus: 60]
        F2[Source Count<br/>3 sources: +10<br/>2 sources: +5<br/>1 source: +0]
        F3[Name Quality<br/>No subspecies: +5<br/>Author match: +5]
    end

    subgraph "Penalty Factors"
        P1[Ambiguity<br/>Multiple matches: -10]
        P2[Partial Match<br/>Genus only: -20]
        P3[Status Issues<br/>Not accepted: -15]
    end

    subgraph "Calculation"
        F1 --> CALC[Sum Factors]
        F2 --> CALC
        F3 --> CALC
        P1 --> CALC
        P2 --> CALC
        P3 --> CALC

        CALC --> NORM[Normalize 0-100]
        NORM --> SCORE[Final Score]
    end

    subgraph "Examples"
        E1[Exact match, 3 sources<br/>100 + 10 + 5 = 100]
        E2[Fuzzy match, 2 sources<br/>80 + 5 + 0 = 85]
        E3[Genus only, 1 source<br/>60 + 0 - 20 = 40]
    end
```

## Data Quality Validation Flow

```mermaid
flowchart TD
    subgraph "Validation Checks"
        V1[Check Duplicates<br/>Same normalized name<br/>Different species_id]
        V2[Check Orphans<br/>Registry entries<br/>No mappings]
        V3[Check Conflicts<br/>Same species<br/>Different trade codes]
        V4[Check Coverage<br/>Sources with<br/>No matches]
    end

    subgraph "Quality Metrics"
        V1 --> M1[Duplicate Count]
        V2 --> M2[Orphan Count]
        V3 --> M3[Conflict Count]
        V4 --> M4[Coverage %]

        M1 --> QS[Quality Score]
        M2 --> QS
        M3 --> QS
        M4 --> QS
    end

    subgraph "Reporting"
        QS --> R1{Score > 95?}
        R1 -->|Yes| P1[PASS: Excellent]
        R1 -->|No| R2{Score > 85?}
        R2 -->|Yes| P2[PASS: Good]
        R2 -->|No| R3{Score > 75?}
        R3 -->|Yes| P3[WARN: Fair]
        R3 -->|No| P4[FAIL: Poor]
    end

    subgraph "Actions"
        P3 --> A1[Review warnings]
        P4 --> A2[Manual intervention]
        P4 --> A3[Re-run matching]
    end
```

## Query Performance Optimization

```mermaid
graph TD
    subgraph "Query Types"
        Q1[Species by Name]
        Q2[Species by Code]
        Q3[Multi-source Join]
        Q4[Cascade Lookup]
    end

    subgraph "Optimization Strategy"
        Q1 --> O1[Use normalized_name index<br/>GIN index on registry]
        Q2 --> O2[Use alpha3_code index<br/>B-tree on ASFIS]
        Q3 --> O3[Use registry as base<br/>Join mappings second]
        Q4 --> O4[Pre-computed in<br/>cascade_resolved]
    end

    subgraph "WoRMS Optimization"
        W1[Need core data only?] -->|Yes| WC[Query worms_core<br/>75% faster]
        W1 -->|No| W2[Need metadata?]
        W2 -->|Yes| WJ[Join extended<br/>when needed]
    end

    subgraph "Best Practices"
        BP1[Always filter by kingdom<br/>when possible]
        BP2[Use match_quality filter<br/>for better results]
        BP3[Limit results with<br/>confidence threshold]
        BP4[Use unified_view for<br/>read-only queries]
    end
```

## Error Recovery Workflow

```mermaid
flowchart TD
    subgraph "Error Detection"
        E1[Import Error] --> ET{Error Type?}
        ET -->|Constraint| EC[FK/UK Violation]
        ET -->|Data| ED[Format/Type Error]
        ET -->|System| ES[Memory/Disk Error]
    end

    subgraph "Recovery Actions"
        EC --> RC1[Check import order]
        EC --> RC2[Verify dependencies]

        ED --> RD1[Clean source data]
        ED --> RD2[Update preprocessing]

        ES --> RS1[Increase resources]
        ES --> RS2[Batch processing]
    end

    subgraph "Validation"
        RC1 --> V[Validate Fix]
        RC2 --> V
        RD1 --> V
        RD2 --> V
        RS1 --> V
        RS2 --> V

        V --> R{Retry Import}
        R -->|Success| S[Continue]
        R -->|Fail| LOG[Log & Skip]
    end

    subgraph "Graceful Degradation"
        LOG --> GD1[Mark source FAILED]
        LOG --> GD2[Continue other imports]
        LOG --> GD3[Partial functionality]
    end
```

## Real-time Integration Monitoring

```mermaid
flowchart LR
    subgraph "Monitoring Points"
        M1[Import Progress]
        M2[Mapping Quality]
        M3[System Resources]
        M4[Error Rate]
    end

    subgraph "Metrics"
        M1 --> MT1[Records/second<br/>Time remaining]
        M2 --> MT2[Match distribution<br/>Confidence avg]
        M3 --> MT3[Memory usage<br/>Disk I/O]
        M4 --> MT4[Errors/hour<br/>Error types]
    end

    subgraph "Alerts"
        MT1 --> A1{Rate < 100/s?}
        MT2 --> A2{Quality < 80%?}
        MT3 --> A3{Memory > 80%?}
        MT4 --> A4{Errors > 1%?}

        A1 -->|Yes| AL1[Performance Alert]
        A2 -->|Yes| AL2[Quality Alert]
        A3 -->|Yes| AL3[Resource Alert]
        A4 -->|Yes| AL4[Error Alert]
    end

    subgraph "Dashboard"
        AL1 --> D[Integration Dashboard]
        AL2 --> D
        AL3 --> D
        AL4 --> D

        D --> ACT[Operator Action]
    end
```

## Usage Example Flows

### Finding a Species
```mermaid
sequenceDiagram
    participant User
    participant API
    participant Registry
    participant Mappings
    participant Sources

    User->>API: Search "tuna"
    API->>Registry: normalize_species_name('tuna')
    Registry->>Registry: Generate patterns
    Registry-->>API: Normalized search

    API->>Registry: Query registry
    Registry-->>API: Species IDs

    API->>Mappings: Get mappings
    Mappings->>Sources: Join WoRMS
    Mappings->>Sources: Join ITIS
    Mappings->>Sources: Join ASFIS

    Sources-->>Mappings: Source data
    Mappings-->>API: Complete records
    API-->>User: Unified results
```

### Trade Code Assignment
```mermaid
sequenceDiagram
    participant Import
    participant ASFIS
    participant Cascade
    participant Registry
    participant Resolved

    Import->>ASFIS: Load species
    ASFIS->>Registry: Create mapping

    Import->>Cascade: Load config
    Cascade->>Registry: Find matching species
    Registry-->>Cascade: Species list

    Cascade->>Resolved: Create resolutions
    Resolved->>Resolved: Store assignments

    Note over Resolved: Pre-computed for<br/>query performance
```
