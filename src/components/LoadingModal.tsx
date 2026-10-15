interface Props {
  title?: string;
  message: string;
}

/** A centered status modal for in-flight async work (initial airport-pack
 * load, starting a session) - same convention as CRC's "Checking for new
 * navigation data" loading overlay. */
export function LoadingModal({ title = "HOLDSHORT", message }: Props) {
  return (
    <div className="loading-overlay">
      <div className="loading-box">
        <div className="loading-title">{title}</div>
        <div className="loading-message">{message}</div>
      </div>
    </div>
  );
}
