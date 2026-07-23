import { PlateCalculator } from '../components/PlateCalculator';

export function PlateCalculatorScreen() {
  return (
    <div>
      <h1>Plate Calculator</h1>
      <p className="muted small">
        Enter how many of each plate you loaded per side. Total = bar + 2 × per-side.
      </p>
      <PlateCalculator />
    </div>
  );
}
