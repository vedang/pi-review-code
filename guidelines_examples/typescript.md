# TypeScript review focus checklist

- Require tests for every changed behavior, including API edges and failure paths.
- Prefer simple, descriptive naming; avoid terse abbreviations and over-engineered abstractions.
- Require or improve JSDoc/TSDoc for exported public functions, interfaces, and nuanced utility behavior.
- Review maintainability: flag long functions, deep nesting, and duplicated logic in changed blocks.
- Check error handling consistency and typed failure modes (avoid broad `catch (e)` without intent).
- Verify naming and boundaries align with existing conventions before suggesting refactors.
- Suggest smaller, composable changes when a review point grows in scope.
