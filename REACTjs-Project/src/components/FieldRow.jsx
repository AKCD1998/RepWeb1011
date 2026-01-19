export default function FieldRow({ label, htmlFor, children }) {
  return (
    <div className="field-row">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}
