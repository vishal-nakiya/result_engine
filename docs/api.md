# API Documentation (v1)

Base URL (dev): `http://localhost:4000/api`

## Health

- `GET /health`

## Dashboard

- `GET /api/dashboard/stats`

Response:

- `totalCandidates`
- `status.cleared|rejected|withheld`
- `allocated`
- `totalPosts`

## Candidates

- `GET /api/candidates`
  - Query: `page`, `pageSize`, `q`, `category`, `gender`, `status`
- `GET /api/candidates/:id`

## Rules

- `GET /api/rules`
- `PUT /api/rules`

Body:

```json
{
  "ruleKey": "cbe.cutoffPercent",
  "value": { "UR": 30, "OBC": 25, "EWS": 25, "SC": 20, "ST": 20, "ESM": 20 },
  "description": "CBE cutoffs",
  "isActive": true
}
```

## CSV Upload

### Preview

- `POST /api/upload/csv`
  - multipart/form-data with `file`

Returns:

- `headers`
- `candidateColumns`
- `autoMapping`
- `unmapped`
- `previewRows`
- `totalRows`
- `csvText` (echoed back for commit)

### Commit

- `POST /api/upload/csv/commit`

Body:

```json
{
  "csvText": "<the preview csvText>",
  "mapping": { "roll_no": "Roll No", "name": "Name", "dob": "DOB", "gender": "Gender", "category": "Category" },
  "stage": "cbe"
}
```

Optional `stage` is stored on each inserted row under `raw_data._upload_meta.stage` (alongside the full CSV row).

## Processing Pipeline

- `POST /api/process/run`

Runs:

1. Validation (PwD reject, missing marks reject, debarred reject)
2. Age validation (DOB range + relaxations)
3. CBE cutoff
4. NCC bonus + final marks
5. Merit rank with tie-breaking
6. Allocation into `allocation`
7. Logs into `logs`

## Logs

- `GET /api/logs?page=1&pageSize=50&level=info`

