import "./StatCard.css";

type StatCardProps = {
  title: string;
  value: number | string;
};

export default function StatCard({ title, value }: StatCardProps) {
  return (
    <div className="pa-statCard">
      <div className="pa-statCard__title">{title}</div>
      <div className="pa-statCard__value">{value}</div>
    </div>
  );
}
