# Jami - Spaced Repetition Learning App

## Overview

Jami is a spaced repetition flashcard application designed to help users master subjects through efficient learning intervals. The app implements a sophisticated scheduling algorithm based on proven memory research, allowing users to create decks, manage notes/cards, and study with an optimized review queue. The application features a full-stack architecture with a React frontend and Express backend, using PostgreSQL for data persistence.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight client-side routing)
- **State Management**: TanStack React Query for server state, Zustand for local UI state
- **UI Components**: Shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS v4 with CSS variables for theming (light/dark mode support)
- **Animations**: Framer Motion for transitions
- **Build Tool**: Vite with custom plugins for Replit integration

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript (ESM modules)
- **API Design**: RESTful JSON endpoints under `/api/*` prefix
- **Database ORM**: Prisma Client for PostgreSQL interactions
- **Session Management**: Express sessions with connect-pg-simple for session storage (30-day TTL, rolling sessions)
- **Authentication**: Replit OIDC (openid-client + passport), session-based auth check (no token expiry validation)

### Data Layer
- **Primary Database**: PostgreSQL
- **Schema Definition**: Prisma schema (primary) with Drizzle config present for migrations
- **Key Models**:
  - `Deck` - Collection of cards with optional parent for nesting
  - `Note` - Content container with flexible JSON fields for front/back content
  - `Card` - Scheduling state (NEW, LEARNING, REVIEW, RELEARNING) with spaced repetition metadata
  - `NoteType` - Defines field structure for notes
  - `Template` - HTML templates for rendering cards
  - `ReviewLog` - Append-only log of all review actions
  - `StudyGoal` - User-defined learning goals with progress tracking

### Spaced Repetition Scheduler
- **Implementation**: Pure function in `shared/scheduler.ts`
- **Algorithm**: Modified SM-2 with learning/relearning steps
- **States**: NEW → LEARNING → REVIEW (with RELEARNING on lapses)
- **Configurable Settings**: Learning steps, graduating intervals, ease factors, lapse handling

### Cloze Deletion Support
- Parser in `shared/cloze.ts` handles `{{c1::answer::hint}}` syntax
- Generates multiple cards from single notes with cloze deletions

### Build System
- **Development**: Vite dev server with HMR
- **Production**: Custom build script using esbuild for server bundling, Vite for client
- **Output**: Single `dist/` folder with server bundle and static public files

## External Dependencies

### Database
- **PostgreSQL**: Primary data store (requires `DATABASE_URL` environment variable)
- **Prisma**: ORM for database operations
- **Drizzle Kit**: Available for schema migrations (`db:push` command)

### UI Libraries
- **Radix UI**: Headless component primitives (dialog, dropdown, tabs, etc.)
- **Recharts**: Data visualization for statistics page
- **Embla Carousel**: Carousel component support
- **React Day Picker**: Calendar component
- **Vaul**: Drawer component

### Utilities
- **date-fns**: Date manipulation for scheduling calculations
- **Zod**: Runtime schema validation
- **uuid**: Unique identifier generation
- **cmdk**: Command palette component

### Replit-Specific
- **@replit/vite-plugin-runtime-error-modal**: Error overlay in development
- **@replit/vite-plugin-cartographer**: Development tooling
- **@replit/vite-plugin-dev-banner**: Development environment indicator