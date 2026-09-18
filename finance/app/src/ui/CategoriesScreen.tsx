import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
  getCategories,
  patchCategory,
  postCategory,
  type CategoryListItem,
  type CategoryPatchBody,
  type CategoryWriteBody,
} from "../api/store.ts";
import type { AppShellOutlet } from "./AppShell.tsx";
import { BottomSheet } from "./BottomSheet.tsx";
import { CategoryFormSheet } from "./CategoryFormSheet.tsx";
import { groupCategoryRows, usageLabel } from "./categories.ts";
import { apiErrorText } from "./copy.ts";
import { FetchError } from "./FetchError.tsx";

function invalidateCatalog(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["categories"] });
  void qc.invalidateQueries({ queryKey: ["settings"] });
  void qc.invalidateQueries({ queryKey: ["books"] });
  void qc.invalidateQueries({ queryKey: ["home"] });
  void qc.invalidateQueries({ queryKey: ["plan"] });
  void qc.invalidateQueries({ queryKey: ["wealth"] });
}

export function CategoriesScreen() {
  const qc = useQueryClient();
  const { onToast } = useOutletContext<AppShellOutlet>();
  const [addOpen, setAddOpen] = useState(false);
  const [edit, setEdit] = useState<CategoryListItem | null>(null);
  const [saving, setSaving] = useState(false);

  const listQ = useQuery({
    queryKey: ["categories"],
    queryFn: getCategories,
    staleTime: 15_000,
  });

  const rows = listQ.data?.categories ?? [];
  const sections = groupCategoryRows(rows);

  async function onAdd(body: CategoryWriteBody) {
    setSaving(true);
    try {
      const res = await postCategory(body);
      onToast(`${res.category?.name ?? body.name} added`);
      setAddOpen(false);
      await invalidateCatalog(qc);
    } catch (err) {
      onToast(apiErrorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function onEdit(id: string, body: CategoryPatchBody) {
    setSaving(true);
    try {
      await patchCategory(id, body);
      onToast("Saved");
      setEdit(null);
      await invalidateCatalog(qc);
    } catch (err) {
      onToast(apiErrorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function onToggleBudget(row: CategoryListItem) {
    try {
      await patchCategory(row.id, { defaultInBudget: !row.defaultInBudget });
      await invalidateCatalog(qc);
    } catch (err) {
      onToast(apiErrorText(err));
    }
  }

  async function onArchive(row: CategoryListItem, next: boolean) {
    try {
      await patchCategory(row.id, { isArchived: next });
      onToast(next ? `${row.name} archived` : `${row.name} restored`);
      await invalidateCatalog(qc);
    } catch (err) {
      onToast(apiErrorText(err));
    }
  }

  return (
    <section className="page">
      <Link to="/more" className="back-link btn-ghost">
        ← More
      </Link>
      <div className="mt-2 flex items-start justify-between gap-3">
        <h1 className="page-title">Categories</h1>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-accent"
        >
          + Add
        </button>
      </div>
      <p className="mt-1 text-sm text-muted">
        Include-in-budget is a default for new rows. Existing ledger rows stay as they were.
      </p>

      {listQ.isPending ? (
        <p className="py-8 text-sm text-muted">Loading categories…</p>
      ) : listQ.error ? (
        <FetchError error={listQ.error} onRetry={() => void listQ.refetch()} />
      ) : rows.length === 0 ? (
        <p className="mt-8 text-sm text-muted">No categories yet. Add one to start logging.</p>
      ) : (
        <div className="mt-4 desk:grid desk:grid-cols-2 desk:gap-x-10 desk:gap-y-2">
          {sections.map((section) => (
            <section key={section.group} className="mb-5">
              <h2 className="kicker">
                {section.group}
              </h2>
              <ul>
                {section.categories.map((row) => (
                  <li key={row.id} className={`border-b border-line py-2 ${row.isArchived ? "opacity-60" : ""}`}>
                    <div className="flex min-h-14 items-center gap-3">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => setEdit(row)}
                      >
                        <span className="block truncate text-base text-ink">
                          {row.name}
                          {row.isArchived ? " · archived" : ""}
                        </span>
                        <span className="block text-xs text-muted">
                          {usageLabel(row.usageCount)}
                        </span>
                      </button>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={row.defaultInBudget}
                        aria-label={`${row.name} default in budget`}
                        onClick={() => void onToggleBudget(row)}
                        className={`shrink-0 rounded-full px-3 py-2 text-xs font-medium ${
                          row.defaultInBudget
                            ? "bg-accent text-accent-fg"
                            : "border border-line text-muted"
                        }`}
                      >
                        Budget
                      </button>
                    </div>
                    <div className="flex gap-3 pb-1">
                      <button
                        type="button"
                        className="min-h-11 text-sm font-medium text-accent"
                        onClick={() => setEdit(row)}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="min-h-11 text-sm font-medium text-muted"
                        onClick={() => void onArchive(row, !row.isArchived)}
                      >
                        {row.isArchived ? "Unarchive" : "Archive"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <BottomSheet open={addOpen} title="Add category" onClose={() => setAddOpen(false)}>
        <CategoryFormSheet
          mode="add"
          categories={rows}
          saving={saving}
          onSaveAdd={onAdd}
          onSaveEdit={() => undefined}
        />
      </BottomSheet>
      <BottomSheet
        open={edit != null}
        title={edit ? edit.name : "Category"}
        onClose={() => setEdit(null)}
      >
        {edit ? (
          <CategoryFormSheet
            mode="edit"
            category={edit}
            categories={rows}
            saving={saving}
            onSaveAdd={() => undefined}
            onSaveEdit={(body) => void onEdit(edit.id, body)}
          />
        ) : null}
      </BottomSheet>
    </section>
  );
}
