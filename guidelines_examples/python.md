# Python review focus checklist

- Require tests for all changed behavior, including regressions and edge cases.
- Prefer straightforward code; avoid dense one-liners and deeply nested control flow.
- Enforce clear naming over clever abbreviations; names should describe intent.
- Require docstrings on new/changed public functions and classes where behavior is not self-evident.
- Check maintainability: look for repeated logic, large functions, and brittle mutable state.
- Track complexity-sensitive changes: if `radon` is available, flag unusually high cognitive/cyclomatic complexity for changed functions.
- Validate error handling for obvious failure paths (timeouts, bad inputs, and cleanup).
