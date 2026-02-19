# API Contracts (Additive)

Existing route `/pose` remains unchanged for migration safety.

## 1) Control Plane: `POST /pose/sentence`

Decides ordered sign targets from sentence text. Returns lightweight control data only.

### Request

```json
{
	"sentence": "hello world"
}
```

### Success Response (`200`)

```json
{
	"signs": [
		{"sign_id": "123", "word": "hello"},
		{"sign_id": "456", "word": "world"}
	],
	"request_id": "a1b2c3d4e5f6",
	"timings": {
		"total_ms": 42.1,
		"db_ms": 28.4
	}
}
```

### Error Cases

- `400 invalid_request` when `sentence` is missing or empty
- `500 db_query_failed` on DB/lookup failure

### Example (PowerShell)

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:5000/pose/sentence -ContentType 'application/json' -Body '{"sentence":"hello world"}'
```

---

## 2) Data Plane (metadata-only for now): `GET /pose/word/<sign_id>`

Returns lightweight metadata for a single sign. No frame payloads are returned in this phase.

### Success Response (`200`)

```json
{
	"sign_id": "123",
	"word": "hello",
	"frame_count": 500,
	"has_pose": true,
	"request_id": "a1b2c3d4e5f6",
	"timings": {
		"total_ms": 8.3,
		"db_ms": 5.9
	}
}
```

### Error Cases

- `400 invalid_sign_id` when `sign_id` is not numeric
- `404 not_found` when `sign_id` does not exist
- `500 db_query_failed` on DB failure

### Example (PowerShell)

```powershell
Invoke-RestMethod -Method Get -Uri http://127.0.0.1:5000/pose/word/123
```

---

## Expected Extension Consumption (next migration step)

1. Call `POST /pose/sentence` with transcript chunk text.
2. For each returned `sign_id` in order, call `GET /pose/word/<sign_id>`.
3. In later phases, `/pose/word/<sign_id>` will return/redirect to asset reference, and client fetches frame payload per sign.

