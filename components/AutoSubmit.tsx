"use client";

/**
 * Auswahlfeld, das sein Formular beim Ändern sofort abschickt. Ohne
 * JavaScript bleibt der Absenden-Knopf des Formulars der Weg.
 */
export function AutoSubmitSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      onChange={(e) => {
        props.onChange?.(e);
        e.currentTarget.form?.requestSubmit();
      }}
    />
  );
}
