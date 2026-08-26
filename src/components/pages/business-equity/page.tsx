"use client";
import { Callout, Currency, MetricCard, Percent, SectionHeader } from '@/components/ui';
import { BusinessForms } from './business-forms';
import type { SectionProps } from '@/components/pages/shared';
const Metric=({value,percent=false}:{value:number|null;percent?:boolean})=>value===null?<span className="warning-text">Non calculable</span>:percent?<Percent value={value}/>:<Currency value={value}/>;
export default function BusinessPage({ state, mutate, busy }:SectionProps) {
  const portfolio=state.businessEquity;
  return <div className="page-stack"><SectionHeader eyebrow="Private assets" title="Business Equity" description="Participations privées : valeur, bridge EV → Equity, détention, capital investi et performance — sans confondre dette corporate et dette personnelle." />
  {!portfolio || state.businesses.length===0 ? <Callout title="Aucune participation déclarée">Ajoute une société puis renseigne sa détention. Une dette corporate à 0 doit être saisie comme 0 si elle est réellement nulle ; une dette inconnue reste vide.</Callout> : <>
    <section className="metrics-grid four"><MetricCard label="Valeur attribuable" value={<Metric value={portfolio.totalAttributableValue.value}/>} tone="positive"/><MetricCard label="Sociétés" value={portfolio.positions.filter(p=>p.ownership).length}/><MetricCard label="Qualité" value={portfolio.quality.blockers.length===0?'Calculable':'Partielle'}/></section>
    <div className="results-stack">{portfolio.positions.map(p=><article className="panel" key={p.business.id}><div className="panel-header"><div><span className="eyebrow">{p.business.type??'TYPE NON DÉCLARÉ'}</span><h2>{p.business.name}</h2></div></div><section className="metrics-grid four"><MetricCard label="Equity Value" value={<Metric value={p.wholeEquityValue.value}/>}/><MetricCard label="Valeur personnelle" value={<Metric value={p.attributableValue.value}/>}/><MetricCard label="Dette nette corporate" value={<Metric value={p.netDebt.value}/>}/><MetricCard label="Détention économique" value={<Metric value={p.ownership?.economicRate??null} percent/>}/><MetricCard label="Capital investi" value={<Metric value={p.investedCapital.value}/>}/><MetricCard label="Cash retourné" value={<Metric value={p.cashReturned.value}/>}/><MetricCard label="MOIC" value={p.moic.value===null?'Non calculable':`${p.moic.value.toFixed(2)}×`}/><MetricCard label="XIRR" value={<Metric value={p.xirr.value} percent/>}/></section>{p.quality.blockers.length>0&&<p className="warning-text">Bloquants : {p.quality.blockers.join(' · ')}</p>}{p.quality.flags.length>0&&<p className="muted">{p.quality.flags.join(' · ')}</p>}</article>)}</div>
  </>}
  <BusinessForms businesses={state.businesses} mutate={mutate} busy={busy}/></div>;
}
