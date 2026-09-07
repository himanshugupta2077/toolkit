import { ApiError, apiUrl } from "../api/http.ts";
import type { ImportResponse, InvestImportResponse } from "../api/store.ts";

export function importFinanceFile(
  file: File,
  replace: boolean,
  onProgress: (pct: number) => void,
): Promise<ImportResponse> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("replace", replace ? "true" : "false");
    const xhr = new XMLHttpRequest();
    xhr.open("POST", apiUrl("/api/import/finance"));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText) as unknown;
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as ImportResponse);
        return;
      }
      reject(new ApiError(xhr.status, body));
    };
    xhr.onerror = () => reject(new ApiError(0, { error: "network error" }));
    xhr.send(form);
  });
}

export function importInvestFile(
  file: File,
  onProgress: (pct: number) => void,
): Promise<InvestImportResponse> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("replace", "true");
    const xhr = new XMLHttpRequest();
    xhr.open("POST", apiUrl("/api/import/invest"));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText) as unknown;
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as InvestImportResponse);
        return;
      }
      reject(new ApiError(xhr.status, body));
    };
    xhr.onerror = () => reject(new ApiError(0, { error: "network error" }));
    xhr.send(form);
  });
}
