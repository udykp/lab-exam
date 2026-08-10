# SecureMLExam

Go backend scaffold for a secure programming and ML examination platform.

## What is included

- Authentication for students and faculty
- Exam, question, assignment, autosave, submission, and violation APIs
- In-memory store for local development
- Reusable domain and service layers
- A clean structure that can be swapped to PostgreSQL and an Electron client later

## Run

```bash
go run ./cmd/server
```

The server listens on `:8080` by default.

## Localhost Test Flow

Use this sequence to verify the full flow on your machine.

### 1. Start the server

```bash
go run ./cmd/server
```

### 2. Check health

```bash
curl http://localhost:8080/healthz
```

Expected response:

```json
{"status":"ok"}
```

### 3. Log in as faculty

```bash
curl -s -X POST http://localhost:8080/api/v1/auth/login \
	-H 'Content-Type: application/json' \
	-d '{"role":"faculty","email":"faculty@securemlexam.local","password":"Admin@123"}'
```

Save the returned `token` value.

### 4. Import students from Excel

Prepare an `.xlsx` file with the first row as headers:

`Name | Roll Number`

Then upload it:

```bash
curl -X POST http://localhost:8080/api/v1/faculty/students/import \
	-H "Authorization: Bearer YOUR_FACULTY_TOKEN" \
	-F "file=@students.xlsx"
```

### 5. Create or verify exam questions

List the fixed questions:

```bash
curl -H "Authorization: Bearer YOUR_FACULTY_TOKEN" \
	http://localhost:8080/api/v1/faculty/exams/exam-1/questions
```

If you want to add or update a numbered question:

```bash
curl -X POST http://localhost:8080/api/v1/faculty/exams/exam-1/questions \
	-H "Authorization: Bearer YOUR_FACULTY_TOKEN" \
	-H 'Content-Type: application/json' \
	-d '{"number":4,"title":"KNN Lab","prompt":"Implement KNN and print accuracy.","language":"python"}'
```

### 6. Assign a chit to a student

```bash
curl -X POST http://localhost:8080/api/v1/faculty/exams/exam-1/chits \
	-H "Authorization: Bearer YOUR_FACULTY_TOKEN" \
	-H 'Content-Type: application/json' \
	-d '{"roll_number":"220101","question_number":4}'
```

### 7. Log in as student

```bash
curl -s -X POST http://localhost:8080/api/v1/auth/login \
	-H 'Content-Type: application/json' \
	-d '{"role":"student","name":"Demo Student","roll_number":"220101","exam_id":"exam-1"}'
```

The response should include the assigned `exam`, `question`, and `assignment` for that student.

### 8. Open the WebSocket

Use any WebSocket client and connect to:

```text
ws://localhost:8080/api/v1/ws?token=YOUR_STUDENT_TOKEN
```

When the faculty assigns a chit or the student autosaves/submits, the socket will receive live events.

## Demo credentials

The seed data creates one faculty user and one student user.

- Faculty: `faculty@securemlexam.local` / `Admin@123`
- Student: `220101` / `Pin@1234`

## Student roster import

Faculty can upload an Excel file to `/api/v1/faculty/students/import` using multipart form data with a `file` field.

The first sheet should contain a header row with `Name` and `Roll Number` columns. Example rows:

| Name | Roll Number |
| --- | --- |
| Ananya Rao | 220101 |
| Ravi Kumar | 220102 |

## Student login

Students now authenticate with name plus roll number:

```json
{
	"role": "student",
	"name": "Ananya Rao",
	"roll_number": "220101"
}
```

After login, the client should call `/api/v1/student/exam?exam_id=<exam-id>` with the returned bearer token to fetch the assigned question.

## Chit assignment

Faculty can assign a chit to a student with:

`POST /api/v1/faculty/exams/{exam-id}/chits`

Example body:

```json
{
	"roll_number": "220101",
	"question_number": 4
}
```

The server stores the assignment and pushes a live `chit_assigned` event to connected clients.

## WebSocket

Connect the student or faculty app to:

`/api/v1/ws?token=<bearer-token>`

The socket broadcasts assignment, autosave, submission, and violation events in real time.

## Next step

Replace the in-memory repository with PostgreSQL and connect the Electron client to the APIs in this scaffold.
