from pathlib import Path
from src.generate_data import generate
from src.pipeline import run

ROOT = Path(__file__).parent

if __name__ == "__main__":
    generate(ROOT / "data" / "raw")
    result = run(ROOT / "data")
    print(f"Pipeline terminé : {result['sales_count']} ventes, {result['event_count']} événements")
    print(f"Réconciliation : {result['reconciliation']['status']}")
    print(f"Qualité : {result['quality']['status']} ({result['quality']['failed']} échec(s))")
    print("Dashboard : python3 serve.py puis http://127.0.0.1:8042")
