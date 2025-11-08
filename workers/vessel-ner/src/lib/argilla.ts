/**
 * Argilla API Client
 *
 * Pushes NER entities to Argilla for SME annotation
 * API: http://argilla.apps.svc.cluster.local:6900
 */

export interface ArgillaConfig {
  apiUrl: string;
  apiKey: string;
}

export interface ArgillaRecord {
  fields: {
    text: string;
    document_id: string;
  };
  metadata?: {
    pdf_name?: string;
    page_number?: number;
    [key: string]: unknown;
  };
  suggestions?: ArgillaSuggestion[];
}

export interface ArgillaSuggestion {
  question_name: string;
  value: ArgillaSpan[];
  score?: number;
  agent?: string;
}

export interface ArgillaSpan {
  start: number;
  end: number;
  label: string;
}

/**
 * Argilla API Client for NER annotation
 *
 * Docs: https://docs.argilla.io/latest/reference/argilla/records/
 */
export class ArgillaClient {
  private apiUrl: string;
  private apiKey: string;
  private workspace: string = 'argilla';
  private datasetName: string = 'vessel-ner';

  constructor(config: ArgillaConfig) {
    this.apiUrl = config.apiUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = config.apiKey;
  }

  /**
   * Create or get dataset
   */
  async ensureDataset(): Promise<void> {
    // Check if dataset exists
    const exists = await this.datasetExists();
    if (exists) {
      console.log(`Dataset ${this.datasetName} already exists`);
      return;
    }

    // Create dataset with NER schema
    await this.createDataset();
  }

  /**
   * Check if dataset exists
   */
  private async datasetExists(): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.apiUrl}/api/v1/datasets/${this.datasetName}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Create NER dataset
   */
  private async createDataset(): Promise<void> {
    const response = await fetch(`${this.apiUrl}/api/v1/datasets`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: this.datasetName,
        workspace: this.workspace,
        settings: {
          guidelines: 'Extract vessel and maritime regulatory information from OCR\'d IUU fishing documents.',
          fields: [
            {
              name: 'text',
              title: 'Document Text',
              required: true,
              type: 'text',
            },
            {
              name: 'document_id',
              title: 'Document ID',
              required: true,
              type: 'text',
            },
          ],
          questions: [
            {
              name: 'entities',
              title: 'Label vessel entities',
              description: 'Select text spans and assign entity types',
              required: true,
              type: 'span',
              labels: this.getEntityLabels(),
            },
          ],
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create dataset: ${error}`);
    }

    console.log(`Dataset ${this.datasetName} created successfully`);
  }

  /**
   * Push records to Argilla
   */
  async pushRecords(records: ArgillaRecord[]): Promise<void> {
    if (records.length === 0) return;

    // Argilla API expects records in batches
    const response = await fetch(
      `${this.apiUrl}/api/v1/datasets/${this.datasetName}/records`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          items: records,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to push records: ${error}`);
    }

    console.log(`Pushed ${records.length} records to Argilla`);
  }

  /**
   * Get entity labels (51 types from your schema)
   */
  private getEntityLabels(): string[] {
    return [
      // Core Identifiers
      'VESSEL_NAME',
      'IMO_NUMBER',
      'MMSI',
      'IRCS_CALL_SIGN',
      'FLAG_STATE',
      'NATIONAL_REGISTRY_NUMBER',
      'EU_CFR_NUMBER',
      // Vessel Specifications
      'VESSEL_TYPE',
      'TONNAGE',
      'LENGTH',
      'ENGINE_POWER',
      'BUILD_YEAR',
      'BUILDER_NAME',
      'HULL_NUMBER',
      // Ownership & Operation
      'OWNER_NAME',
      'OWNER_ADDRESS',
      'OPERATOR_NAME',
      'BENEFICIAL_OWNER',
      'CHARTER_COMPANY',
      'REGISTRATION_PORT',
      // Compliance & Authorization
      'RFMO_NAME',
      'AUTHORIZATION_NUMBER',
      'LICENSE_NUMBER',
      'PERMIT_TYPE',
      'VALIDITY_PERIOD',
      'AUTHORIZED_AREA',
      'AUTHORIZED_SPECIES',
      // Watchlist & Risk
      'IUU_LISTING',
      'SANCTION_TYPE',
      'VIOLATION_TYPE',
      'DETENTION_PORT',
      'INSPECTION_DATE',
      // Species & Catch
      'SPECIES_NAME',
      'SPECIES_CODE',
      'CATCH_QUANTITY',
      'CATCH_UNIT',
      'FISHING_GEAR_TYPE',
      // Historical Events
      'PREVIOUS_NAME',
      'PREVIOUS_FLAG',
      'NAME_CHANGE_DATE',
      'FLAG_CHANGE_DATE',
      'OWNERSHIP_TRANSFER_DATE',
      // Geographic & Temporal
      'PORT_NAME',
      'COORDINATES',
      'DATE',
      'REPORTING_PERIOD',
      // Organizations & Officials
      'GOVERNMENT_AGENCY',
      'INSPECTION_AUTHORITY',
      'CERTIFYING_BODY',
      'OFFICIAL_NAME',
      'OFFICIAL_TITLE',
    ];
  }
}
