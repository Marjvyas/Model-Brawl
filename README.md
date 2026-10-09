# Model Brawl

A full-stack machine learning web application that allows users to upload datasets, run preprocessing and exploratory data analysis (EDA), train and compare 9 different regression models, and evaluate the best model on held-out test data.

## Project Structure

```
model_brawl/
├── Frontend/          - React + Vite frontend application
└── Backend/           - FastAPI backend server
```

## Frontend

### Technologies
- React 19
- Vite 8
- Chart.js 4
- Plotly.js
- Oxlint (for code quality)

### Available Scripts
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run lint` - Lint with Oxlint
- `npm run preview` - Preview production build

### Key Components
- `App.jsx` - Main application component with routing
- `NotebookSandbox.jsx` - Jupyter-style Python notebook (runs in the browser via Pyodide)
- `PreviewView.jsx` - Dataset preview with data manipulation tools
- `UndoRedoButton.jsx` - Undo/Redo for dataset changes
- `ElectricBorder.jsx` - Custom border component
- `CustomSelect.jsx` - Enhanced select dropdown
- `SvgIcon.jsx` - SVG icon component
- `Header.jsx` - Application header
- `ActionHistoryContext.jsx` - Context for managing undo/redo history
- `notebook/nb_runtime.py` + `notebook/pyodideRuntime.js` - the in-browser Python "kernel" and its JS bridge

### API Integration
The frontend communicates with the FastAPI backend at `http://localhost:8000`:
- `GET /api/health` - Health check
- `POST /api/upload` - Upload CSV dataset
- `POST /api/prepare` - Prepare data for pipeline
- `POST /api/run` - Run ML pipeline (preprocessing + EDA)
- `POST /api/train` - Train models
- `POST /api/model_details/{task_id}` - Get details for a specific model
- `POST /api/update_dtypes` - Update column data types
- `POST /api/delete_column` - Delete a column
- `POST /api/undo_dataset` - Undo last dataset change
- `POST /api/redo_dataset` - Redo undone change
- `POST /api/reset_dataset` - Reset dataset to original state
- `POST /api/dataset_history` - Get undo/redo history status
- `POST /api/chat` - Chat with AI about the dataset and results
- `GET /api/notebook/{stored_as}/state` - Ordered steps (with code) behind the current dataset
- `GET /api/notebook/{stored_as}/base` - The original upload (starting point for replaying steps)
- `POST /api/notebook/{stored_as}/commit` - Apply notebook cells to the app's dataset

## Backend

### Technologies
- FastAPI
- Python (pandas, numpy, scikit-learn, scipy)
- ML pipeline with 9 model tournament

### API Endpoints
- `GET /api/health` - Health check endpoint
- `POST /api/upload` - Upload and parse CSV file
- `POST /api/prepare` - Run phase 1 preprocessing
- `POST /api/run` - Run full ML pipeline (background task)
- `POST /api/train` - Run model training phase
- `POST /api/model_details/{task_id}` - Get details for a specific model
- `POST /api/update_dtypes` - Update column data types
- `POST /api/delete_column` - Delete a column from dataset
- `POST /api/undo_dataset` - Undo last dataset change
- `POST /api/redo_dataset` - Redo undone change
- `POST /api/reset_dataset` - Reset dataset to original state
- `POST /api/dataset_history` - Get undo/redo history status
- `POST /api/chat` - Chat with AI about dataset and results (needs the `CHAT_API_KEY` environment variable, or a key typed into the chat settings)
- `GET /api/notebook/{stored_as}/state`, `GET /api/notebook/{stored_as}/base`, `POST /api/notebook/{stored_as}/commit` - Python notebook (see below)

### Python Notebook
Notebook code runs in the browser (Pyodide); the server never executes it. Every dataset change (UI button or committed cells) is a step in `.uploads/.history/<file>/history.json`, stored with the Python code that produced it. Opening the notebook replays those steps on the original upload, so new cells continue exactly where the app is. Commit replaces the dataset and, if the pipeline already ran, recomputes preprocessing + EDA.

### ML Pipeline
The backend includes a comprehensive ML pipeline that:
1. Applies user-defined feature forge recipes
2. Handles data cleaning (duplicates, null values, outliers)
3. Automatically detects categorical vs continuous features
4. Trains and evaluates 9 regression models:
   - OLS Linear Regression
   - Ridge Regression
   - Lasso Regression
   - Elastic Net
   - Polynomial Regression (Degree 2)
   - Decision Tree
   - Random Forest
   - Gradient Boosting (GBM)
   - Support Vector Regression (SVR)
5. Uses automated mode selection based on dataset size:
   - 5-Fold CV for datasets ≤ 10,000 rows
   - 3-Fold CV for datasets 10K-50K rows
   - Single 80/20 train/validation split for datasets > 50K rows
6. Generates comprehensive EDA insights:
   - Feature importance (Mutual Information scores)
   - Correlation matrix
   - Target correlations
   - Skewness transformations
7. Selects the best model based on CV R² score
8. Runs a "Final Exam" on held-out test data
9. Provides model recommendations based on performance

### Key Pipeline Functions
- `imp_phase1()` - Data preprocessing and feature engineering
- `imp_phase2()` - Categorical encoding, scaling, skewness transformation
- `build_model_registry()` - Returns the 9-model registry
- `ultimate_model_selector()` - Evaluates all 9 models and returns leaderboard
- `final_exam()` - Trains winner on full training set and evaluates on test data

## Deployment

### Local Development
0. First time only: `cd Backend && python -m venv venv && venv\Scripts\activate && pip install -r requirements.txt` and `cd Frontend && npm install`
1. Start the backend: `cd Backend && uvicorn main:app --reload --port 8000`
2. Start the frontend: `cd Frontend && npm run dev`
3. Access the app at `http://localhost:3000` (the port set in `vite.config.js`)
4. API available at `http://localhost:8000`

### GitHub Deployment
See the deployment instructions in the project wiki or follow these steps:

1. Initialize git: `git init`
2. Add all files: `git add .` (the root `.gitignore` keeps venv, node_modules and uploaded data out)
3. Commit: `git commit -m "Initial commit"`
4. Link to GitHub remote: `git remote add origin https://github.com/username/repo.git`
5. Force push: `git push -u origin main --force`

## License

This project is for demonstration purposes.