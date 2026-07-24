/**
 * Primary action button.
 * Eval task: change default label from "Submit" to "Continue" and update tests.
 */
export function Button({ label = 'Submit', onClick }) {
  return (
    <button type="button" className="primary-button" onClick={onClick}>
      {label}
    </button>
  );
}

export const PRIMARY_LABEL = 'Submit';
