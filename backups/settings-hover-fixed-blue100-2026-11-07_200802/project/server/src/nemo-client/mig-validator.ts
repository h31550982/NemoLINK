import { Injectable } from '@nestjs/common';
import Ajv2020 from 'ajv/dist/2020';
import type { ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { MIG_SCHEMAS, MIG_VERSION } from './generated/mig-schemas';

export interface MigValidationError {
  /** JSON pointer into the envelope ('' = root) */
  pointer: string;
  message: string;
}

/**
 * Validates formality envelopes against the vendored MIG schemas (invariant 4:
 * outbound payloads must pass before send — fail closed). All schemas compile at
 * construction, so a broken vendored schema is a startup error, never a runtime one.
 */
@Injectable()
export class MigValidator {
  private readonly validators = new Map<string, ValidateFunction>();

  constructor() {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    for (const [type, schema] of Object.entries(MIG_SCHEMAS)) {
      this.validators.set(type, ajv.compile(schema));
    }
  }

  get version(): string {
    return MIG_VERSION;
  }

  get types(): string[] {
    return [...this.validators.keys()];
  }

  validate(formalityType: string, envelope: unknown): MigValidationError[] {
    const validate = this.validators.get(formalityType);
    if (!validate) {
      throw new Error(
        `Unknown formality type '${formalityType}' (MIG ${MIG_VERSION}; known: ${this.types.join(', ')})`,
      );
    }
    if (validate(envelope)) return [];
    return (validate.errors ?? []).map((e) => ({
      pointer: e.instancePath,
      message: `${e.message ?? 'invalid'} ${JSON.stringify(e.params)}`,
    }));
  }
}
