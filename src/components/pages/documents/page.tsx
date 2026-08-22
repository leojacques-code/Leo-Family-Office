"use client";

import { useState } from "react";
import { FileText, FolderOpen, LockKeyhole, UploadCloud } from "lucide-react";
import { EmptyState, SectionHeader } from "@/components/ui";
import type { SectionProps } from "@/components/pages/shared";

function DocumentsPage({ state, refresh }: SectionProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploading(true);
    setError("");
    const body = new FormData(event.currentTarget);
    const response = await fetch("/api/documents", { method: "POST", body });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) setError(payload.error ?? "Import impossible");
    else {
      event.currentTarget.reset();
      await refresh();
    }
    setUploading(false);
  }
  const categories = [
    "bank",
    "investment",
    "tax",
    "real_estate",
    "business",
    "employment",
    "loan",
    "insurance",
    "other",
  ];
  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Private vault"
        title="Documents"
        description="Coffre local privé. Les fichiers ne sont jamais publics et aucun identifiant bancaire n’est accepté."
      />
      <section className="document-layout">
        <form className="panel upload-panel" onSubmit={upload}>
          <span className="upload-icon">
            <UploadCloud size={24} />
          </span>
          <h2>Déposer un document</h2>
          <p>PDF, PNG, JPG, CSV ou XLSX · 8 Mo maximum</p>
          <input
            id="document-file"
            type="file"
            name="file"
            accept=".pdf,.png,.jpg,.jpeg,.csv,.xlsx"
            required
          />
          <label htmlFor="document-file" className="button primary">
            Choisir un fichier
          </label>
          <select className="text-input" name="category" defaultValue="other">
            {categories.map((category) => (
              <option key={category} value={category}>
                {category.replace("_", " ")}
              </option>
            ))}
          </select>
          <button className="button secondary" disabled={uploading}>
            {uploading ? "Import…" : "Ajouter à l’inbox"}
          </button>
          {error ? <div className="form-error">{error}</div> : null}
          <small>
            <LockKeyhole size={13} />
            Stockage local privé dans cette V1
          </small>
        </form>
        <article className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Inbox</span>
              <h2>Documents non classés</h2>
            </div>
            <span className="nav-count">
              {state.documents.filter((document) => document.status === "INBOX").length}
            </span>
          </div>
          {state.documents.length ? (
            <div className="document-list">
              {state.documents.map((document) => (
                <div key={document.id}>
                  <span className="document-icon">
                    <FileText size={17} />
                  </span>
                  <span>
                    <strong>{document.name}</strong>
                    <small>
                      {document.category} · {(document.size / 1024).toFixed(1)} Ko ·{" "}
                      {new Date(document.uploadedAt).toLocaleDateString("fr-FR")}
                    </small>
                  </span>
                  <span className="status-outline">Inbox</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Coffre vide"
              detail="Le premier fichier importé apparaîtra ici, sans analyse automatique en V1."
            />
          )}
        </article>
      </section>
      <section className="category-cards">
        {categories.map((category) => (
          <div key={category}>
            <FolderOpen size={17} />
            <span>{category.replace("_", " ")}</span>
            <strong>
              {state.documents.filter((document) => document.category === category).length}
            </strong>
          </div>
        ))}
      </section>
    </div>
  );
}

export default DocumentsPage;
