require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 5001;

// Configuration
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const FIXED_SLOTS = new Set(["ASSEMBLY", "BREAK", "LUNCH"]);

// Supabase Configuration (read-only for timetable_client)
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ? process.env.VITE_SUPABASE_URL.replace(/\/$/, '') : null;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || null;

// In-memory data
let classesData = {};
let teacherNames = {};

// Helper functions
function useSupabaseRest() {
    return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function supabaseHeaders(extra = {}) {
    return {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        ...extra
    };
}

function normalizeTime(t) {
    t = t.trim().replace(/'/g, "").replace(/\u2019/g, "").replace(/\u2018/g, "");
    t = t.replace(/(\d+):(\d+)\s*-\s*(\d+):(\d+)/g, '$1:$2-$3:$4');
    return t;
}

async function loadFromSupabase() {
    classesData = {};
    teacherNames = {};
    
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        console.error('Supabase credentials not configured');
        return;
    }
    
    try {
        const resp = await axios.get(`${SUPABASE_URL}/rest/v1/timetable`, {
            headers: supabaseHeaders()
        });
        
        if (resp.status === 200) {
            const records = resp.data;
            for (const record of records) {
                if (record.schedule_data) {
                    Object.assign(classesData, record.schedule_data);
                }
                if (record.teacher_names) {
                    Object.assign(teacherNames, record.teacher_names);
                }
            }
            console.log(`Loaded from Supabase: ${Object.keys(classesData).length} classes, ${Object.keys(teacherNames).length} teachers`);
        }
    } catch (e) {
        console.error('Error loading from Supabase:', e.message);
    }
}

function timeSortKey(t) {
    const m = t.match(/(\d+):(\d+)/);
    if (m) {
        let h = parseInt(m[1]);
        const mins = parseInt(m[2]);
        if (h >= 1 && h <= 6) h += 12;
        return h * 60 + mins;
    }
    return 0;
}

function buildTeacherSchedules() {
    const teachers = {};
    
    for (const [className, schedule] of Object.entries(classesData)) {
        for (const [ts, dayData] of Object.entries(schedule)) {
            for (const [day, cell] of Object.entries(dayData)) {
                if (!cell || cell === '--') continue;
                
                const cu = cell.toUpperCase().trim();
                if (FIXED_SLOTS.has(cu) || ['CPD', 'NONE', ''].includes(cu)) continue;
                
                const m = cell.match(/\((\d+)\)/);
                if (m) {
                    const code = m[1];
                    const subject = cell.replace(/\s*\(\d+\)\s*/g, '').trim();
                    
                    if (!teachers[code]) {
                        teachers[code] = { subjects: new Set(), classes: new Set(), schedule: {} };
                    }
                    teachers[code].subjects.add(subject);
                    teachers[code].classes.add(className);
                    
                    if (!teachers[code].schedule[ts]) {
                        teachers[code].schedule[ts] = {};
                    }
                    teachers[code].schedule[ts][day] = `${subject} (${className})`;
                }
            }
        }
    }
    
    // Collect all time slots and sort
    const allTimes = new Set();
    for (const schedule of Object.values(classesData)) {
        Object.keys(schedule).forEach(t => allTimes.add(t));
    }
    
    const sortedTimes = Array.from(allTimes).sort(timeSortKey);
    
    // Detect fixed time slots
    const fixedMap = {};
    for (const ts of sortedTimes) {
        const vals = new Set();
        for (const schedule of Object.values(classesData)) {
            if (ts in schedule) {
                for (const day of DAYS) {
                    const v = (schedule[ts][day] || '').toUpperCase().trim();
                    if (FIXED_SLOTS.has(v)) {
                        vals.add(v);
                    }
                }
            }
        }
        if (vals.size === 1) {
            fixedMap[ts] = Array.from(vals)[0];
        }
    }
    
    const result = {};
    for (const [code, data] of Object.entries(teachers)) {
        const name = teacherNames[code] || `Teacher ${code}`;
        const fullSchedule = {};
        
        for (const ts of sortedTimes) {
            fullSchedule[ts] = {};
            for (const day of DAYS) {
                if (ts in fixedMap) {
                    fullSchedule[ts][day] = fixedMap[ts];
                } else if (ts in data.schedule && day in data.schedule[ts]) {
                    fullSchedule[ts][day] = data.schedule[ts][day];
                } else {
                    fullSchedule[ts][day] = '--';
                }
            }
        }
        
        result[code] = {
            name: name,
            code: code,
            subjects: Array.from(data.subjects).sort(),
            classes: Array.from(data.classes).sort(),
            schedule: fullSchedule
        };
    }
    
    return result;
}

// Express middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'html');
app.set('views', path.join(__dirname, 'templates'));
app.engine('html', require('ejs').renderFile);

// Routes
app.get('/', (req, res) => {
    const teacherSchedules = buildTeacherSchedules();
    const sortedTeachers = Object.values(teacherSchedules).sort((a, b) => {
        const aCode = parseInt(a.code) || 0;
        const bCode = parseInt(b.code) || 0;
        return aCode - bCode;
    });
    res.render('index', { 
        classes: classesData, 
        teachers: sortedTeachers, 
        teacherNames: teacherNames, 
        days: DAYS 
    });
});

app.get('/api/classes', (req, res) => {
    res.json(classesData);
});

app.get('/api/teachers', (req, res) => {
    res.json(buildTeacherSchedules());
});

app.get('/api/time', (req, res) => {
    const now = new Date();
    res.json({
        current_time: now.toTimeString().split(' ')[0],
        current_date: now.toISOString().split('T')[0],
        day_of_week: now.toLocaleDateString('en-US', { weekday: 'long' }),
        full_datetime: now.toISOString().replace('T', ' ').split('.')[0]
    });
});

app.post('/api/reload', async (req, res) => {
    await loadFromSupabase();
    res.json({
        success: true,
        classes_loaded: Object.keys(classesData).length,
        teachers_loaded: Object.keys(teacherNames).length
    });
});

app.get('/export_teacher/:code', (req, res) => {
    const teachers = buildTeacherSchedules();
    const code = req.params.code;
    
    if (!teachers[code]) {
        return res.status(404).json({ error: 'Teacher not found' });
    }
    
    const t = teachers[code];
    const wb = XLSX.utils.book_new();
    const wsData = [
        [`Teacher: ${t.name} (Code ${t.code})`],
        [`Classes: ${t.classes.join(', ')}`],
        [],
        ['Time', ...DAYS]
    ];
    
    for (const [ts, dd] of Object.entries(t.schedule)) {
        const row = [ts];
        for (const day of DAYS) {
            row.push(dd[day] || '--');
        }
        wsData.push(row);
    }
    
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, `${t.name} (${t.code})`);
    
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', `attachment; filename=Timetable_${t.name}_Code${t.code}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
});

app.get('/export_all_teachers', (req, res) => {
    const teachers = buildTeacherSchedules();
    const wb = XLSX.utils.book_new();
    
    const sortedTeachers = Object.values(teachers).sort((a, b) => {
        const aCode = parseInt(a.code) || 0;
        const bCode = parseInt(b.code) || 0;
        return aCode - bCode;
    });
    
    for (const t of sortedTeachers) {
        const wsData = [
            [`Teacher: ${t.name} (Code ${t.code})`],
            [`Classes: ${t.classes.join(', ')}`],
            [],
            ['Time', ...DAYS]
        ];
        
        for (const [ts, dd] of Object.entries(t.schedule)) {
            const row = [ts];
            for (const day of DAYS) {
                row.push(dd[day] || '--');
            }
            wsData.push(row);
        }
        
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        const sheetName = `${t.name.substring(0, 20)}(${t.code})`;
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }
    
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename=All_Teacher_Timetables.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
});

app.post('/chat', async (req, res) => {
    const { message, history = [] } = req.body;
    
    const now = new Date();
    const current_time_info = `Current Date and Time: ${now.toISOString().replace('T', ' ').split('.')[0]} (${now.toLocaleDateString('en-US', { weekday: 'long' })})`;
    
    // Group classes by level
    const levelData = {};
    for (const [cn, schedule] of Object.entries(classesData)) {
        const levelMatch = cn.match(/^(L\d+\s+\w+)/);
        if (levelMatch) {
            const level = levelMatch[1];
            if (!levelData[level]) levelData[level] = {};
            Object.assign(levelData[level], schedule);
        } else {
            levelData[cn] = schedule;
        }
    }
    
    let context = "You are a school timetable assistant. Here is the current timetable data (sorted from morning assembly to evening):\n\n";
    context += `${current_time_info}\n\n`;
    
    for (const [level, schedule] of Object.entries(levelData)) {
        context += `## Level: ${level}\n`;
        const sortedTs = Object.keys(schedule).sort(timeSortKey);
        for (const ts of sortedTs) {
            const dd = schedule[ts];
            context += `  ${ts}: ` + Object.entries(dd).map(([d, v]) => `${d}=${v}`).join(', ') + '\n';
        }
    }
    
    const teachers = buildTeacherSchedules();
    context += "\n## Teachers:\n";
    for (const [code, t] of Object.entries(teachers)) {
        context += `  Code ${code}: ${t.name} - Classes: ${t.classes.join(', ')} - Subjects: ${t.subjects.join(', ')}\n`;
    }
    context += `\nTeacher code mapping: ${JSON.stringify(teacherNames)}\n`;
    context += "\nFormat: SUBJECT(CODE) means teacher with that code teaches that subject.\nWhen asked to create a teacher timetable, format it as a markdown table with Time slots as rows and Monday-Friday as columns.\n";
    
    const messages = [
        { role: 'system', content: context },
        ...history,
        { role: 'user', content: message }
    ];
    
    try {
        const resp = await axios.post('http://localhost:11434/api/chat', {
            model: 'deepseek-v3.1:671b-cloud',
            messages: messages,
            stream: false
        }, { timeout: 120000 });
        
        if (resp.status === 200) {
            const responseContent = resp.data.message?.content || 'No response';
            res.json({ response: responseContent });
        } else {
            res.json({ response: `Ollama error: ${resp.status}` });
        }
    } catch (e) {
        if (e.code === 'ECONNREFUSED') {
            res.json({ response: 'Cannot connect to Ollama. Make sure Ollama is running (ollama serve) and the model deepseek-v3.1:671b-cloud is available.' });
        } else {
            res.json({ response: `Error: ${e.message}` });
        }
    }
});

// Auto reload from Supabase every 30 seconds
function autoReloadThread() {
    setInterval(async () => {
        try {
            console.log('Auto-reloading timetables from Supabase...');
            await loadFromSupabase();
            console.log('Auto-reload completed');
        } catch (e) {
            console.error('Auto-reload error:', e.message);
        }
    }, 30000);
}

// Start server
async function startServer() {
    await loadFromSupabase();
    autoReloadThread();
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Timetable Client server running on port ${PORT}`);
        console.log('Connected to Supabase for shared timetable data');
    });
}

startServer();
