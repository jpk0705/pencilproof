type WorksheetLine = { label: string; value: string; emphasis?: boolean };

export default function GuideWorksheetExample({ title, explanation, lines, question }: { title: string; explanation: string; lines: WorksheetLine[]; question: string }) {
  const structuredData = { "@context": "https://schema.org", "@type": "HowTo", name: title, description: explanation, step: lines.map((line) => ({ "@type": "HowToStep", name: line.label, text: `${line.label}: ${line.value}` })) };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} /><section className="section shell guide-example" aria-label={`Worked example: ${title}`}>
    <div className="section-intro compact"><p className="kicker">FICTIONAL WORKED EXAMPLE</p><h2>{title}</h2><p>{explanation}</p></div>
    <figure className="worksheet-example"><div className="worksheet-example-head"><span>ILLUSTRATIVE WORKSHEET</span><b>Not a customer document</b></div><dl>{lines.map((line) => <div className={line.emphasis ? "worksheet-example-total" : ""} key={line.label}><dt>{line.label}</dt><dd>{line.value}</dd></div>)}</dl><figcaption><strong>Ask:</strong> {question}</figcaption></figure>
  </section></>;
}
