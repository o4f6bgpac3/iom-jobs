# Contributing to IOM Job Scraper

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

### Prerequisites

- Node.js 18 or later
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- A Cloudflare account (free tier works fine)
- A [Venice.ai](https://venice.ai/) API key (for LLM features)

### Initial Setup

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/your-username/iom-job-scraper.git
   cd iom-job-scraper
   ```

2. **Install worker dependencies**
   ```bash
   cd worker
   npm install
   ```

3. **Create your configuration files**
   ```bash
   cp wrangler.toml.example wrangler.toml
   cp .dev.vars.example .dev.vars
   ```

4. **Create Cloudflare resources**
   ```bash
   # Create D1 database
   wrangler d1 create iom-jobs
   # Note the database_id and add it to wrangler.toml

   # Create KV namespace for rate limiting
   wrangler kv:namespace create RATE_LIMITER
   # Note the id and add it to wrangler.toml
   ```

5. **Initialize the database**
   ```bash
   wrangler d1 execute iom-jobs --file=database.sql
   ```

6. **Add your secrets**
   Edit `.dev.vars` and add your LLM API key:
   ```
   LLM_API_KEY=your_api_key_here
   ```

### Running Locally

**Backend (Worker):**
```bash
cd worker
wrangler dev
```
The API will be available at `http://localhost:8787`

**Frontend:**
```bash
cd app
npx serve .
```
Or simply open `app/index.html` in your browser.

The frontend automatically detects the environment and connects to `localhost:8787` during local development.

## Project Structure

```
iom-job-scraper/
├── app/                    # Frontend (static site)
│   ├── index.html         # Main HTML
│   ├── app.js             # Main application logic
│   ├── config.js          # Frontend configuration
│   ├── jobCard.js         # Job card component
│   ├── jobList.js         # Job list renderer
│   ├── filters.js         # Filter panel component
│   ├── askComponent.js    # Natural language query UI
│   └── styles.css         # Stylesheet
│
├── worker/                 # Backend (Cloudflare Worker)
│   ├── worker.js          # Main entry point & routing
│   ├── config.js          # Centralized configuration
│   ├── scraper.js         # Job scraping logic
│   ├── parser.js          # HTML parsing utilities
│   ├── ask.js             # /ask endpoint handler
│   ├── llm.js             # LLM integration (configurable provider)
│   ├── queryBuilder.js    # SQL query generation
│   ├── validation.js      # Zod schemas & input validation
│   ├── prompts.js         # LLM prompt templates
│   ├── rateLimiter.js     # Rate limiting logic
│   ├── utils.js           # Shared utilities
│   └── database.sql       # Database schema
│
├── README.md
├── CONTRIBUTING.md
└── LICENSE
```

## Code Style

### JavaScript

- Use ES6+ features (const/let, arrow functions, template literals)
- Use camelCase for variables and functions
- Use PascalCase for classes
- Add JSDoc comments to exported functions
- Keep functions focused and small

### SQL

- Use descriptive aliases (e.g., `j` for jobs)
- Add comments for complex queries
- Always use parameterized queries (never concatenate user input)

### Commits

- Write clear, concise commit messages
- Use present tense ("Add feature" not "Added feature")
- Reference issues when applicable

## Deploying

Deploy your worker manually from the `worker/` directory:

```bash
cd worker
wrangler deploy
```

The `wrangler.toml` file is gitignored so each contributor can use their own Cloudflare resources. See the [Deployment section in README.md](README.md#deployment) for details on setting up automatic deployments if desired.

## Making Changes

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**

3. **Test locally**
   - Run `wrangler dev` and test the API
   - Test the frontend in your browser
   - Verify existing functionality still works

4. **Commit your changes**
   ```bash
   git add .
   git commit -m "Add brief description of change"
   ```

5. **Push and create a pull request**
   ```bash
   git push origin feature/your-feature-name
   ```

## Pull Request Guidelines

- Provide a clear description of what the PR does
- Link any related issues
- Keep PRs focused on a single change
- Ensure the code follows the project style
- Test your changes before submitting

## Security Considerations

When contributing, please be mindful of:

- **SQL Injection**: Always use parameterized queries
- **Input Validation**: Validate all user input with Zod schemas
- **Prompt Injection**: The LLM prompts have injection detection; don't bypass it
- **Secrets**: Never commit API keys or sensitive configuration

## Questions?

Feel free to open an issue if you have questions or need help getting started!
