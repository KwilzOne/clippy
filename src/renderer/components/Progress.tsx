export type ProgressProps = {
  progress: number;
};

export const Progress: React.FC<ProgressProps> = ({ progress }) => {
  const percent = Math.min(100, Math.max(0, Math.round(progress)));

  return (
    <div
      className="progress-indicator segmented"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span
        className="progress-indicator-bar"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
};
