export default function FieldRow({ label, htmlFor, children, className = "" }) {
  return (
    <div className={`field-row ${className}`.trim()}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}
