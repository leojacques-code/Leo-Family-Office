"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Callout, Currency, DataBadge, MetricCard, SectionHeader } from "@/components/ui";
import type { SectionProps } from "@/components/pages/shared";

function CareerPage({ state }: SectionProps) {
  const [track, setTrack] = useState("M&A → PE");
  const tracks = [
    { name: "M&A long terme", base: 42, growth: 0.12, bonus: 9 },
    { name: "M&A → PE", base: 42, growth: 0.16, bonus: 9 },
    { name: "Corporate Development", base: 40, growth: 0.08, bonus: 6 },
    { name: "Transaction Services", base: 40, growth: 0.09, bonus: 7 },
    { name: "Startup / scale-up", base: 38, growth: 0.1, bonus: 4 },
    { name: "Entrepreneuriat", base: 20, growth: 0.28, bonus: 0 },
  ];
  const selected = tracks.find((item) => item.name === track) ?? tracks[0];
  const salaryData = Array.from({ length: 9 }, (_, year) => ({
    year: 2027 + year,
    fixed: selected.base * Math.pow(1 + selected.growth, year),
    variable: selected.bonus * Math.pow(1.08, year),
    total:
      selected.base * Math.pow(1 + selected.growth, year) + selected.bonus * Math.pow(1.08, year),
  }));
  const variableAssumption = state.assumptions.find(
    (assumption) => assumption.id === "asm_variable",
  );
  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Human capital"
        title="Career"
        description="Trajectoires de rémunération séparées du patrimoine observé. Les courbes sont des hypothèses, pas des promesses."
      />
      <section className="metrics-grid four">
        <MetricCard
          label="Fixe central premier CDI"
          value={<Currency value={42000} />}
          detail="Brut annuel"
        />
        <MetricCard
          label="Variable central"
          value={<Currency value={Number(variableAssumption?.value ?? 9000)} />}
          detail="Hypothèse faible confiance"
          tone="warning"
        />
        <MetricCard
          label="Revenu actuel net"
          value={<Currency value={state.metrics.monthlyIncome} />}
          detail="Mensuel"
        />
        <MetricCard
          label="Horizon M&A avant tentative PE"
          value="≈ 2 ans"
          detail="Scénario, non certitude"
        />
      </section>
      <Callout tone="warning" title="Courbes non sourcées en V1">
        Les valeurs ci-dessous sont des hypothèses de travail internes datées du 19 août 2026. Elles
        doivent être remplacées par des benchmarks externes vérifiés.
      </Callout>
      <section className="career-layout">
        <article className="panel track-list">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Branches</span>
              <h2>Trajectoire testée</h2>
            </div>
          </div>
          {tracks.map((item) => (
            <button
              key={item.name}
              className={track === item.name ? "active" : ""}
              onClick={() => setTrack(item.name)}
            >
              <span>
                <strong>{item.name}</strong>
                <small>Croissance modèle {Math.round(item.growth * 100)} %/an</small>
              </span>
              <ChevronRight size={16} />
            </button>
          ))}
        </article>
        <article className="panel chart-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Rémunération brute hypothétique</span>
              <h2>{track}</h2>
            </div>
            <DataBadge kind="MODEL_ASSUMPTION" />
          </div>
          <div className="medium-chart tall">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={salaryData}>
                <defs>
                  <linearGradient id="salaryArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#39747a" stopOpacity={0.25} />
                    <stop offset="1" stopColor="#39747a" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border-soft)" />
                <XAxis dataKey="year" axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(value) => `${value} k€`} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => `${Number(value).toFixed(1)} k€`} />
                <Area
                  type="monotone"
                  dataKey="total"
                  name="Total"
                  stroke="#39747a"
                  fill="url(#salaryArea)"
                />
                <Line type="monotone" dataKey="fixed" name="Fixe" stroke="#9b8555" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Premier CDI</span>
            <h2>Fourchettes initiales</h2>
          </div>
        </div>
        <div className="salary-bands">
          <div>
            <span>Minimum</span>
            <strong>40 k€ fixe</strong>
            <small>+ 3 k€ variable</small>
          </div>
          <div className="central">
            <span>Central</span>
            <strong>42 k€ fixe</strong>
            <small>+ 9 k€ variable hypothétique</small>
          </div>
          <div>
            <span>Maximum</span>
            <strong>45 k€ fixe</strong>
            <small>+ 15 k€ variable</small>
          </div>
        </div>
      </section>
    </div>
  );
}

export default CareerPage;
