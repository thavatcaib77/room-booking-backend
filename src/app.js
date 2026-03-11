// src/app.js — Entry Point
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import connectPgSimple from 'connect-pg-simple';

import { pool } from './config/db.js';
import { logger } from './utils/logger.js';
import { apiLimiter } from './middleware/rateLimit.js';

// Routes
import authRouter from './modules/auth/auth.routes.js';
import roomsRouter from './modules/rooms/rooms.routes.js';
import bookingsRouter from './modules/bookings/bookings.routes.js';
import notificationsRouter from './modules/notifications/notifications.routes.js';
import adminRouter from './modules/admin/admin.routes.js';
import recurringRouter from './modules/recurring/recurring.routes.js';
import reportsRouter from './modules/reports/reports.routes.js';

// Passport config
import './modules/auth/passport.config.js';

// Cron jobs
import { startHolidaySyncCron } from './modules/holidays/holidaySync.service.js';
import { startReminderCron } from './modules/email/emailReminder.cron.js';

const app = express();
const PgSession = connectPgSimple(session);
const PgStore = connectPgSimple(session);

// ─── Security & Parsing ───────────────────────────────
app.use(helmet());

app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "https://room-booking-frontend-099r2zexk-thavatcaib77s-projects.vercel.app"
    ],
    credentials: true
  })
);

app.options("*", cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Session (stored in PostgreSQL) ──────────────────
// app.use(session({
//   store: new PgSession({
//     pool,
//     tableName: 'user_sessions'
//   }),
//   secret: process.env.SESSION_SECRET || "dev-secret",
//   resave: false,
//   saveUninitialized: false,
//   cookie: {
//     secure: process.env.NODE_ENV === 'production',
//     httpOnly: true,
//     maxAge: 7 * 24 * 60 * 60 * 1000
//   }
// }));
app.use(
  session({
    store: new PgStore({
      pool: pool,
      tableName: "user_sessions",
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,
      httpOnly: true,
      sameSite: "none"
    }
  })
);

// ─── Passport ─────────────────────────────────────────
app.use(passport.initialize());
app.use(passport.session());

// ─── Rate Limiting ────────────────────────────────────
app.use('/api', apiLimiter);

// ─── Routes ───────────────────────────────────────────
app.use('/auth', authRouter);
app.use('/api/rooms', roomsRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/recurring', recurringRouter);
app.use('/api/reports', reportsRouter);

// ─── Health Check ─────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date()
  });
});

// Root test
app.get("/", (req, res) => {
  res.send("API running");
});

// ─── 404 Handler ──────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// ─── Error Handler ────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error(`[Error] ${err.message}`, { stack: err.stack });

  const status = err.status ?? 500;

  res.status(status).json({
    error: err.message ?? "Internal server error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack })
  });
});

// ─── Start Server ─────────────────────────────────────
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  logger.info(`Server running on port ${PORT}`);

  // start cron jobs
  startHolidaySyncCron();
  startReminderCron();
});

process.on('uncaughtException', err => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

export default app;
