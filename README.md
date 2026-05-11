# Timetable App (Node.js)

This is the Node.js version of the timetable management system admin application. It allows administrators to upload, manage, and distribute school timetables.

## Features

- **Upload Timetables**: Upload Excel (.xlsx, .xls) or CSV files containing class timetables
- **Class Management**: View, print, and delete class timetables
- **Teacher Management**: View, print, and export teacher timetables
- **AI Chat Integration**: Ask questions about timetables using Ollama AI
- **Database Support**: PostgreSQL or Supabase for data persistence
- **Auto-reload**: Automatically reloads timetables from database

## Installation

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

3. Configure your database connection in `.env`

## Database Setup

### PostgreSQL (Local)

Create a database named `timetable_db`:
```sql
CREATE DATABASE timetable_db;
```

The application will automatically create the required tables on startup.

### Supabase (Cloud)

Set your Supabase URL and anon key in the `.env` file. The application will use Supabase REST API instead of direct PostgreSQL connection.

## Usage

### Start the server

```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

The server will start on port 5000 (configurable via PORT environment variable).

### Access the application

Open your browser and navigate to:
```
http://localhost:5000
```

## API Endpoints

- `GET /` - Main application page
- `POST /upload` - Upload timetable files
- `DELETE /delete_class/:className` - Delete a class timetable
- `POST /update_cell` - Update a timetable cell
- `GET /api/classes` - Get all class timetables
- `GET /api/teachers` - Get all teacher timetables
- `GET /api/time` - Get current time
- `POST /api/reload` - Reload timetables from database
- `DELETE /api/delete_all` - Delete all timetables
- `GET /export_teacher/:code` - Export a teacher's timetable as Excel
- `GET /export_all_teachers` - Export all teacher timetables as Excel
- `POST /chat` - AI chat endpoint (requires Ollama running)

## AI Chat Integration

The AI chat feature requires Ollama to be running with the `deepseek-v3.1:671b-cloud` model:

1. Install Ollama: https://ollama.ai
2. Start Ollama: `ollama serve`
3. Pull the model: `ollama pull deepseek-v3.1:671b-cloud`

## File Structure

```
timetable_app/
├── server.js          # Main application server
├── package.json       # Dependencies and scripts
├── .env.example       # Environment variables template
├── upload/            # Uploaded timetable files
└── templates/
    └── index.html     # Frontend template
```

## Dependencies

- express - Web framework
- multer - File upload handling
- pg - PostgreSQL client
- axios - HTTP client
- xlsx - Excel file processing
- ejs - Template engine
- dotenv - Environment variable management

## Notes

- The client application (timetable_client) shares the same upload folder for real-time synchronization
- Teacher codes are automatically extracted from timetable files in the format "1: TeacherName"
- Fixed slots (ASSEMBLY, BREAK, LUNCH) are automatically detected and highlighted
