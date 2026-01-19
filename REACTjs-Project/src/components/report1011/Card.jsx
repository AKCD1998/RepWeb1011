export default function Card({ title, className = "", children }) {
  return (
    <section className={`card ${className}`.trim()}>
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  );
}
