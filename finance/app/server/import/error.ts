export class ImportError extends Error {
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ImportError";
    this.details = details;
  }
}

export class FinanceImportError extends ImportError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
    this.name = "FinanceImportError";
  }
}
