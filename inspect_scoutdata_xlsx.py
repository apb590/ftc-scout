import urllib.request
import pandas as pd
import zipfile
import io
import xml.etree.ElementTree as ET

sheet_id = "1xd7_lOFnMaMExin_48RLCsT3KGH6VFX5ujqmIFJCSa0"
xlsx_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=xlsx"
xlsx_path = "/Users/alden/.gemini/antigravity/scratch/scoutdata.xlsx"

print("Downloading new ScoutData Google Sheet as XLSX...")
req = urllib.request.Request(
    xlsx_url,
    headers={'User-Agent': 'Mozilla/5.0'}
)

try:
    with urllib.request.urlopen(req) as resp:
        xlsx_data = resp.read()
    with open(xlsx_path, "wb") as f:
        f.write(xlsx_data)
    print("Download completed and saved locally.")
    
    xl = pd.ExcelFile(xlsx_path, engine='openpyxl')
    print("\n==============================================")
    print("Workbook Tab Names inside new ScoutData Sheet:")
    print("==============================================")
    for i, name in enumerate(xl.sheet_names):
        print(f"  {i+1}. Tab Name: {name}")
    print("==============================================\n")
    
    # Inspect each sheet's structure
    for name in xl.sheet_names:
        df = xl.parse(name)
        print(f"\nWorksheet: {name}")
        print(f"  Shape: {df.shape} (Rows: {df.shape[0]}, Columns: {df.shape[1]})")
        print("  Columns:")
        for idx, col in enumerate(df.columns[:20]):
            print(f"    {idx+1}. {col}")
        if len(df.columns) > 20:
            print(f"    ... and {len(df.columns) - 20} more columns")
        print("  Sample Data (First 2 Rows):")
        print(df.head(2).to_string())
        print("-" * 50)
            
except Exception as e:
    print("Fatal Error unzipping or reading sheets:", e)
