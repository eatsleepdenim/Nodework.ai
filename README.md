# AI Node System

A visual, node-based editor for constructing complex, chained AI workflows using the Gemini API.

## Features

- **Visual Graph Editor**: Drag and drop nodes to create thoughts, processes, and flows.
- **Node-Based Logic**: Connect nodes to pass information. 
    - **Linear**: Step-by-step refinement.
    - **Branching**: Parallel processing/brainstorming.
    - **Merging**: Synthesis of multiple inputs.
- **Custom Components**: Save sub-graphs as "Minified" components (📦) to reuse logic and keep your workspace clean.
- **Real-time Execution**: Run your graph against quizzes or custom prompts using Google's Gemini Flash model.
- **Recursive Execution**: Nested components run their own internal graphs recursively.
- **Mermaid JS Export**: View your graph as text/code.
- **Community Submission**: Submit your architectures to the community database for review.

## Setup

1. Clone the repository.
2. Create a `.env` file (if running locally/server-side) or ensure your environment has `API_KEY` set for the Gemini API.
   - *Note: This project is configured for a buildless or lightweight build environment. The API Key is expected in `process.env.API_KEY`.*
3. Open `index.html` (via a local server like `http-server` or `vite`).

## Community Database

We maintain a curated list of high-performance AI architectures. 

To submit your configuration:
1. Open the application.
2. Create or select a configuration.
3. In the list view, click **"Submit"**.
4. Fill in your author name and a brief description.
5. Click **"Submit for Review"**.

Pending submissions are reviewed for safety and utility before being added to the global preset list.

## License

Apache-2.0
