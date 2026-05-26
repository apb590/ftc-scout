import pandas as pd

xlsx_path = "/Users/alden/.gemini/antigravity/scratch/scoutdata.xlsx"
xl = pd.ExcelFile(xlsx_path, engine='openpyxl')

sheets = ["Match Briefing", "Qual Schedule", "Team List", "Team Analytics"]

for name in sheets:
    df = xl.parse(name)
    print(f"\n=======================================================")
    print(f"Worksheet: {name}")
    print(f"=======================================================")
    print(f"Shape: {df.shape}")
    print("\nFull Dataframe:")
    print(df.to_string())
    print("-" * 60)
