from __future__ import annotations

import ast
import json
from pathlib import Path


NOTEBOOK_DIR = Path(r"C:\Users\bjacobsen\Downloads")
MODEL_NOTEBOOK = NOTEBOOK_DIR / "BIO_PTO_Run_Model_ONLY.ipynb"
REPORT_NOTEBOOK = NOTEBOOK_DIR / "BIO_PTO_Generate_Report_ONLY.ipynb"


def load_notebook(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(path)
    return json.loads(path.read_text(encoding="utf-8"))


def source_text(notebook: dict) -> str:
    return "\n".join("".join(cell.get("source", [])) for cell in notebook.get("cells", []))


def assert_code_syntax(notebook: dict, path: Path) -> None:
    for index, cell in enumerate(notebook.get("cells", [])):
        if cell.get("cell_type") != "code":
            continue
        src = "".join(cell.get("source", []))
        # Notebook shell magics are valid in notebooks but not Python AST.
        if src.lstrip().startswith("!"):
            continue
        try:
            ast.parse(src)
        except SyntaxError as exc:
            raise AssertionError(f"{path.name} cell {index} has a syntax error: {exc}") from exc


def require(text: str, needle: str, label: str) -> None:
    if needle not in text:
        raise AssertionError(f"Missing {label}: {needle}")


def reject(text: str, needle: str, label: str) -> None:
    if needle in text:
        raise AssertionError(f"Unexpected {label}: {needle}")


def validate_model(notebook: dict) -> None:
    text = source_text(notebook)
    require(text, "NOTEBOOK_TEST_MODE", "model test-mode flag")
    require(text, "_bio_pto_connect_gis", "model GIS test connector")
    require(text, "BIO_PTO_TEST_PROJECT_INPUT", "model project test env var")
    require(text, "review_status", "review status field")
    require(text, "reviewed_potential", "reviewed potential field")
    require(text, "final_report_description", "final report description field")
    require(text, "PTO_Buffer", "model buffer output")
    require(text, "PTO_CNDDB", "model CNDDB output")
    require(text, "Summary_Statistics", "model summary output")
    require(text, "Approx_Credits_Used", "model credit output")
    reject(text, "PTO_Animals_Word_Doc = animals_docx_out", "model animal Word output assignment")
    reject(text, "PTO_Plants_Word_Doc = plants_docx_out", "model plant Word output assignment")
    reject(text, "PTO_Summary_Excel = workbook_path", "model Excel output assignment")


def validate_report(notebook: dict) -> None:
    text = source_text(notebook)
    require(text, "NOTEBOOK_TEST_MODE", "report test-mode flag")
    require(text, "_bio_pto_connect_gis", "report GIS test connector")
    require(text, "BIO_PTO_TEST_REVIEWED_SUMMARY_TABLE", "report summary test env var")
    require(text, "reviewed_summary_table_url", "report summary table input")
    require(text, "reviewed_potential", "report reviewed potential source")
    require(text, "final_report_description", "report final description source")
    require(text, "Report_Potential", "report potential fallback field")
    require(text, "Report_Description", "report description fallback field")
    require(text, "PTO_Summary_Excel_Link", "report Excel link output")
    require(text, "PTO_Animals_Word_Doc_Link", "report animal link output")
    require(text, "PTO_Plants_Word_Doc_Link", "report plant link output")


def main() -> None:
    model = load_notebook(MODEL_NOTEBOOK)
    report = load_notebook(REPORT_NOTEBOOK)

    assert_code_syntax(model, MODEL_NOTEBOOK)
    assert_code_syntax(report, REPORT_NOTEBOOK)
    validate_model(model)
    validate_report(report)

    print("Notebook validation passed.")
    print(f"Model notebook: {MODEL_NOTEBOOK}")
    print(f"Report notebook: {REPORT_NOTEBOOK}")


if __name__ == "__main__":
    main()
