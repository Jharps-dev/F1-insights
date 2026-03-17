# Forbidden Actions (Beast Mode)

Unless explicitly justified and approved by task scope, do not:
- delete files because they look unused
- rename contracts without migration notes
- flatten package/service boundaries
- move business logic into UI components
- expose provider payloads directly to app routes/components
- create hidden fallback behaviour
- swallow exceptions silently
- add mocks to production paths without loud labelling
- claim tests passed when they were not run
- create giant catch-all utility files
- duplicate schemas in multiple packages
- bypass replay compatibility for a live feature
- replace repo-specific code with generic templates
- make broad rewrites when a localised fix is sufficient
