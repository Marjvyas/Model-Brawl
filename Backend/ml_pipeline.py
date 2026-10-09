import warnings
warnings.filterwarnings("ignore")

import numpy as np # type: ignore
import pandas as pd

from sklearn.preprocessing import StandardScaler, PowerTransformer, OneHotEncoder, PolynomialFeatures, OrdinalEncoder
from sklearn.experimental import enable_iterative_imputer
from sklearn.impute import IterativeImputer, SimpleImputer
from sklearn.model_selection import train_test_split, cross_val_score, KFold
from sklearn.pipeline import make_pipeline
from sklearn.linear_model import LinearRegression, Ridge, Lasso, ElasticNet
from sklearn.tree import DecisionTreeRegressor
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.svm import SVR
from sklearn.metrics import r2_score, mean_squared_error
from sklearn.feature_selection import mutual_info_regression
from sklearn.preprocessing import TargetEncoder
import re


# ═══════════════════════════════════════════════════════════
# FEATURE FORGE — Custom Feature Generation & Transformation
# ═══════════════════════════════════════════════════════════
def apply_feature_forge(df, recipe_book, log=print):
    """
    Applies user-defined formulas to the RAW DataFrame BEFORE any
    preprocessing.  For each recipe:
      1. Parse the formula to discover which existing columns it uses
         (case-insensitively: 'X*Y*Z' matches columns x, y, z).
      2. Evaluate the formula row-by-row via pandas .eval() on the
         ORIGINAL values (no transformation / standardization applied yet).
      3. Insert the result column at the position of the FIRST referenced
         input column (never appended last — that would make it the target).
      4. Drop every input column consumed by the formula.
      5. Never touch the target column (always the last column).

    Raises ValueError when a recipe cannot be applied (unknown column,
    invalid formula, name collision) so callers surface the error instead
    of silently proceeding with the unchanged dataset.
    """
    if not recipe_book:
        return df

    target_col = df.columns[-1]
    lower_cols = {str(c).lower() for c in df.columns}

    import builtins
    builtin_names = set(dir(builtins))

    for recipe in recipe_book:
        # Frontend sends 'new_column'; older payloads used 'new_column_name'
        new_col = str(recipe.get("new_column") or recipe.get("new_column_name") or "").strip()
        formula = str(recipe.get("formula") or "").strip()
        if not new_col or not formula:
            raise ValueError("Each recipe needs a 'formula' and a 'new_column' name.")

        if new_col == target_col:
            raise ValueError(f"Recipe rejected: '{new_col}' is the target column and cannot be used as a feature name.")
        if new_col in df.columns:
            raise ValueError(f"Recipe rejected: column '{new_col}' already exists. Choose a different name.")

        # --- 1. Discover referenced columns (case-insensitive, whole-word) ---
        # Sort longest-first so longer names match before shorter ones
        # (prevents "x" matching inside "x_mean").
        candidates = sorted(
            [c for c in df.columns if str(c).lower() != str(target_col).lower()],
            key=len, reverse=True
        )
        input_cols = []
        for col in candidates:
            # Use word-boundary regex to find whole-word matches
            pattern = r'(?<![A-Za-z0-9_])' + re.escape(str(col)) + r'(?![A-Za-z0-9_])'
            if re.search(pattern, formula, re.IGNORECASE):
                input_cols.append(col)

        if not input_cols:
            raise ValueError(
                f"Formula '{formula}' does not reference any existing column. "
                f"Available columns: {', '.join(str(c) for c in df.columns)}."
            )

        # Rewrite formula identifiers so case-mismatched tokens resolve to the
        # actual column names ('X' -> 'x'). Python builtin / function names are
        # left untouched so 'np.log(...)', 'abs(...)' etc. keep working.
        def _resolve_token(m):
            tok = m.group(0)
            if tok in df.columns or tok in builtin_names or tok == 'np':
                return tok
            matches = [c for c in df.columns if str(c).lower() == tok.lower()]
            if len(matches) == 1:
                log(f"  [OK] FeatureForge: case-corrected '{tok}' -> '{matches[0]}' in formula.")
                return matches[0]
            return tok

        eval_formula = re.sub(r'[A-Za-z_][A-Za-z0-9_]*', _resolve_token, formula)

        # --- 2. Evaluate the formula on the raw (original) values ---
        try:
            new_data = df.eval(eval_formula)
        except Exception as e:
            tokens = set(re.findall(r'[A-Za-z_][A-Za-z0-9_]*', formula))
            unknown = sorted(
                t for t in tokens
                if t not in df.columns
                and t.lower() not in lower_cols
                and t not in builtin_names
                and t != 'np'
            )
            hint = f" Unknown column(s): {', '.join(unknown)}." if unknown else ""
            raise ValueError(
                f"Formula '{formula}' could not be evaluated ({e}).{hint} "
                f"Available columns: {', '.join(str(c) for c in df.columns)}."
            )

        if isinstance(new_data, pd.DataFrame):
            # .eval() can return a DF when the expression is an assignment -
            # grab the relevant column
            if new_col in new_data.columns:
                new_data = new_data[new_col]
            else:
                new_data = new_data.iloc[:, -1]

        # --- 3. Find insertion position (first input column) ---
        col_positions = [df.columns.get_loc(c) for c in input_cols if c in df.columns]
        insert_pos = min(col_positions) if col_positions else len(df.columns) - 1

        # --- 4. Drop consumed input columns ---
        cols_to_drop = [c for c in input_cols if c in df.columns]
        df = df.drop(columns=cols_to_drop)

        # After dropping, clamp insert_pos to valid range
        # (must stay before the target column)
        max_pos = len(df.columns) - 1  # just before target
        insert_pos = min(insert_pos, max_pos)

        # --- 5. Insert new column in-place ---
        df.insert(insert_pos, new_col, new_data.values)

        log(f"  [OK] FeatureForge: Created '{new_col}' = {formula}  "
            f"(replaced {cols_to_drop} at position {insert_pos})")

    # Sanity: ensure target is still the last column
    if df.columns[-1] != target_col and target_col in df.columns:
        col_order = [c for c in df.columns if c != target_col] + [target_col]
        df = df[col_order]

    return df

def imp_phase1(df, log=print, progress_cb=None, recipe_book=None):
    def update_progress(msg, pct):
        if progress_cb:
            try:
                progress_cb(msg, pct)
            except Exception:
                pass

    # ── Feature Forge: apply user formulas on RAW data ──
    if recipe_book:
        update_progress("Applying Feature Forge recipes...", 5)
        log(f"FeatureForge: Applying {len(recipe_book)} recipe(s) on raw data...")
        df = apply_feature_forge(df, recipe_book, log=log)

    update_progress("Cleaning data & handling duplicates...", 10)

    # Convert pyarrow-backed columns to numpy dtypes to prevent
    # sklearn/pandas compatibility issues (e.g., large_string breaks quantile).
    # Only targets arrow columns — skips already-numpy ones for speed.
    for col in df.columns:
        col_dtype = str(df[col].dtype).lower()
        if 'arrow' in col_dtype or 'large_string' in col_dtype or 'string[python]' in col_dtype:
            # Try numeric first, fall back to object
            converted = pd.to_numeric(df[col], errors='coerce')
            if converted.notna().sum() > 0.5 * df[col].notna().sum():
                df[col] = converted
            else:
                df[col] = df[col].astype(object)

    original_shape = df.shape
    duplicates_removed = df.duplicated().sum()
    df = df.drop_duplicates()
    
    # 0. Drop index columns (e.g., ID, Sr. No.) where number of unique values equals total rows
    target_col = df.columns[-1]
    total_rows = len(df)
    index_cols_to_drop = [col for col in df.columns[:-1] if df[col].nunique() == total_rows]
    if index_cols_to_drop:
        log(f"Dropping index columns (all unique values): {index_cols_to_drop}")
        df = df.drop(columns=index_cols_to_drop)
    
    # 1. Deleting the rows which are having null values in target column
    target_col = df.columns[-1]
    null_target_rows = df[target_col].isna().sum()
    df = df.dropna(subset=[target_col])
    
    # 2. Deleting those columns in which (total number of null values) > 40%
    null_per = df.isna().mean() * 100
    col_to_delete = null_per[null_per > 40].index
    columns_dropped_high_null = list(col_to_delete)
    df = df.drop(columns=col_to_delete)

    # 3. Deleting those rows in which (total number of null values in entire row) > 30%
    df = df[df.isna().mean(axis=1) * 100 <= 30]

    # 4. Deleting rows with at least one null if total number of such rows < 5%
    rows_with_nulls = df.isna().any(axis=1)
    percentage = rows_with_nulls.mean() * 100
    if percentage < 5:
        df = df.dropna()
        
    # 5. Check if dataset is too small
    if len(df) < 30:
        raise ValueError("Pipeline Halted: Dataset is too small (less than 30 clean rows).")

    target_data = df[target_col]

    # Use target_data (the Pandas Series) for the checks, NOT target_col (the string)
    is_text = (
        pd.api.types.is_object_dtype(target_data) or 
        pd.api.types.is_string_dtype(target_data) or 
        isinstance(target_data.dtype, pd.CategoricalDtype)
    )

    is_bool = pd.api.types.is_bool_dtype(target_data)
    has_few_uniques = target_data.nunique() < 15

    if is_text or is_bool or has_few_uniques:
        raise ValueError(
            f"Categorical Halt Triggered! Target column '{target_col}' "
            f"is text, boolean, or has < 15 unique values ({target_data.nunique()}). "
            "This is a Classification problem."
        )
        
    df = df.reset_index(drop=True)
    y = df[target_col]
    X = df.drop(columns=[target_col])


    # ==========================================
    # STEP 1.8: Target Variable (Y) Skewness Fix
    # ==========================================
    target_skewness = float(y.skew())
    target_transform_applied = None
    if target_skewness > 1.0:
        if y.min() >= 0:
            log(f"Target variable '{target_col}' is highly skewed (Skew: {y.skew():.2f}). Applying log1p transformation.")
            y = np.log1p(y)
            target_transform_applied = "log1p"
        else:
            log(f"Warning: Target '{target_col}' is skewed but contains negative values. Log transform skipped.")
    
    # Keep only columns that have more than 1 unique value
    X = X.loc[:, X.nunique() > 1]


    datetime_cols = X.select_dtypes(include=['datetime', 'datetimetz']).columns
    
    for col in datetime_cols:
        # Extract meaningful numeric features
        X[f'{col}_year'] = X[col].dt.year
        X[f'{col}_month'] = X[col].dt.month
        X[f'{col}_day'] = X[col].dt.day
        # Drop the original string/datetime column to prevent crashes
        X = X.drop(columns=[col]) 

    categorical_cols = []
    continuous_cols = []

    for col in X.columns:
        N = len(X)
        max_allowed_categories = N * 0.20 
        
        is_string_like = (
            pd.api.types.is_object_dtype(X[col]) or
            pd.api.types.is_string_dtype(X[col]) or
            X[col].dtype.name == 'category' or
            'string' in str(X[col].dtype).lower() or
            'arrow' in str(X[col].dtype).lower()
        )
        if is_string_like or (X[col].nunique() < 15 and X[col].nunique() < max_allowed_categories):
            categorical_cols.append(col)
        else:
            continuous_cols.append(col)

    log(f"Found {len(categorical_cols)} categorical features and {len(continuous_cols)} continuous features.")

    update_progress("Encoding categorical features & scaling...", 30)

    # ==========================================
    # 1. SPLIT THE DATA FIRST
    # ==========================================
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    X_train_cat = X_train[categorical_cols].copy()
    X_test_cat = X_test[categorical_cols].copy()

    X_train_cont = X_train[continuous_cols].copy()
    X_test_cont = X_test[continuous_cols].copy()
    
    for col in continuous_cols:
        lower_bound = X_train_cont[col].quantile(0.01)
        upper_bound = X_train_cont[col].quantile(0.99)
        
        X_train_cont[col] = np.clip(X_train_cont[col], lower_bound, upper_bound)
        X_test_cont[col] = np.clip(X_test_cont[col], lower_bound, upper_bound)



    return (
        X_train_cat, X_test_cat, X_train_cont, X_test_cont,
        y_train, y_test, categorical_cols, continuous_cols, target_col,
        original_shape, duplicates_removed, null_target_rows,
        columns_dropped_high_null, target_skewness, target_transform_applied, list(df.shape),
        index_cols_to_drop
    )

def imp_phase2(X_train_cat, X_test_cat, X_train_cont, X_test_cont, 
               y_train, y_test, categorical_cols, continuous_cols, target_col, 
               original_shape, duplicates_removed, null_target_rows, 
               columns_dropped_high_null, target_skewness, target_transform_applied, final_shape, 
               index_cols_to_drop=None, encoding_config=None, log=print, progress_cb=None):
    def update_progress(msg, pct):
        if progress_cb:
            try:
                progress_cb(msg, pct)
            except Exception:
                pass

    if encoding_config is None:
        encoding_config = {}

    # ==========================================
    # 4. INTERACTIVE CATEGORICAL ENCODING
    # ==========================================
    if len(categorical_cols) > 0:
        X_train_cat_encoded = pd.DataFrame(index=X_train_cat.index)
        X_test_cat_encoded = pd.DataFrame(index=X_test_cat.index)
        
        for col in categorical_cols:
            col_config = encoding_config.get(col, {"type": "onehot"})
            enc_type = col_config.get("type", "onehot")
            

            if enc_type in ["onehot", "nominal"]:
                # 1. Fill nulls with "Missing" explicitly BEFORE calculating frequencies
                X_train_cat[col] = X_train_cat[col].fillna("Missing")
                X_test_cat[col] = X_test_cat[col].fillna("Missing")

                # 2. Calculate frequencies on the filled data
                frequencies = X_train_cat[col].value_counts(normalize=True)
                rare_categories = frequencies[frequencies < 0.02].index

                # 3. Group rare categories into "Other" using fast boolean masking
                if len(rare_categories) > 0:
                    X_train_cat.loc[X_train_cat[col].isin(rare_categories), col] = 'Other'
                    X_test_cat.loc[X_test_cat[col].isin(rare_categories), col] = 'Other'
            
            if enc_type == "ordinal":
                order = col_config.get("order", [])
                if order:
                    encoder = OrdinalEncoder(categories=[order], handle_unknown='use_encoded_value', unknown_value=np.nan)
                else:
                    encoder = OrdinalEncoder(handle_unknown='use_encoded_value', unknown_value=np.nan)
                
                X_train_cat_encoded[col] = encoder.fit_transform(X_train_cat[[col]])
                X_test_cat_encoded[col] = encoder.transform(X_test_cat[[col]])
                
            elif enc_type == "target":
                encoder = TargetEncoder(target_type='continuous', smooth="auto", random_state=42)
                X_train_cat_encoded[col] = encoder.fit_transform(X_train_cat[[col]], y_train)
                X_test_cat_encoded[col] = encoder.transform(X_test_cat[[col]])
                
            else: # onehot (N-1)
                encoder = OneHotEncoder(drop='first', sparse_output=False, handle_unknown='ignore')
                train_encoded = encoder.fit_transform(X_train_cat[[col]])
                test_encoded = encoder.transform(X_test_cat[[col]])
                
                # Some OneHotEncoder versions might not have get_feature_names_out, fallback to simple naming
                if hasattr(encoder, 'get_feature_names_out'):
                    col_names = encoder.get_feature_names_out([col])
                else:
                    col_names = [f"{col}_{i}" for i in range(train_encoded.shape[1])]
                
                train_encoded_df = pd.DataFrame(train_encoded, columns=col_names, index=X_train_cat.index)
                test_encoded_df = pd.DataFrame(test_encoded, columns=col_names, index=X_test_cat.index)
                
                X_train_cat_encoded = pd.concat([X_train_cat_encoded, train_encoded_df], axis=1)
                X_test_cat_encoded = pd.concat([X_test_cat_encoded, test_encoded_df], axis=1)
    else:
        # Safe fallback for purely numeric datasets
        X_train_cat_encoded = pd.DataFrame()
        X_test_cat_encoded = pd.DataFrame()

    # Reset index to ensure alignment for concatenation
    # This prevents errors like "Index has different keys" if any encodings were skipped
    X_train_cat_encoded = X_train_cat_encoded.reset_index(drop=True)
    X_test_cat_encoded = X_test_cat_encoded.reset_index(drop=True)
    X_train_cont = X_train_cont.reset_index(drop=True)
    X_test_cont = X_test_cont.reset_index(drop=True)
    if hasattr(y_train, 'reset_index'):
        y_train = y_train.reset_index(drop=True)
        y_test = y_test.reset_index(drop=True)
    
    X_train_combined = pd.concat([X_train_cat_encoded, X_train_cont], axis=1)
    X_test_combined = pd.concat([X_test_cat_encoded, X_test_cont], axis=1)

    # ==========================================
    # 5. SCALING & DYNAMIC IMPUTATION (MICE vs Simple Safety Net)
    # ==========================================
    update_progress("Imputing missing values...", 50)
    scaler = StandardScaler()
    X_train_scaled = pd.DataFrame(scaler.fit_transform(X_train_combined), columns=X_train_combined.columns, index=X_train_combined.index)
    X_test_scaled = pd.DataFrame(scaler.transform(X_test_combined), columns=X_test_combined.columns, index=X_test_combined.index)

    if X_train_scaled.isna().sum().sum() > 0:
        log("Missing values detected. Engaging IterativeImputer (MICE)...")
        imputer = IterativeImputer(random_state=42, max_iter=3, n_nearest_features=min(10, max(1, X_train_scaled.shape[1])))
    else:
        log("Clean data detected. Engaging lightning-fast SimpleImputer safety net...")
        imputer = SimpleImputer(strategy='median')

    X_train_final = pd.DataFrame(imputer.fit_transform(X_train_scaled), columns=X_train_scaled.columns, index=X_train_scaled.index)
    X_test_final = pd.DataFrame(imputer.transform(X_test_scaled), columns=X_test_scaled.columns, index=X_test_scaled.index)

    # ==========================================
    # 5.5. SKEWNESS TRANSFORMATION
    # ==========================================
    update_progress("Applying skewness transformations...", 65)
    pt = PowerTransformer(method='yeo-johnson', standardize=True)
    skewness_tracker = {}
    
    for col in continuous_cols:
        before_skew = float(X_train_final[col].skew())
        if abs(before_skew) > 1.0:
            log(f"Transforming skewed feature: {col}")
            X_train_final[col] = pt.fit_transform(X_train_final[col].values.reshape(-1, 1))
            X_test_final[col] = pt.transform(X_test_final[col].values.reshape(-1, 1))
            after_skew = float(X_train_final[col].skew())
            skewness_tracker[col] = {"before": before_skew, "after": after_skew}

    # ==========================================
    # 5.8. EDA PAYLOAD CALCULATION
    # ==========================================
    eda_payload = calculate_eda(
        X_train_final, 
        y_train, 
        target_col, 
        skewness_tracker=skewness_tracker, 
        log=log, 
        progress_cb=progress_cb
    )

    # ==========================================
    # 6. RETURN ALL FOUR SPLITS + PREPROCESSING REPORT
    # ==========================================
    preprocessing_report = {
        "original_shape": list(original_shape),
        "target_column": target_col,
        "duplicates_removed": int(duplicates_removed),
        "null_target_rows_dropped": int(null_target_rows),
        "columns_dropped_high_null": columns_dropped_high_null,
        "index_cols_dropped": index_cols_to_drop if index_cols_to_drop is not None else [],
        "num_categorical_features": len(categorical_cols),
        "num_continuous_features": len(continuous_cols),
        "target_skewness": target_skewness,
        "target_transform_applied": target_transform_applied,
        "final_shape": final_shape,
        "train_size": len(X_train_final),
        "test_size": len(X_test_final),
        "eda_payload": eda_payload,
    }
    return X_train_final, X_test_final, y_train, y_test, preprocessing_report



def calculate_eda(X_train_final, y_train, target_col, skewness_tracker=None, log=print, progress_cb=None):
    if skewness_tracker is None:
        skewness_tracker = {}
        
    def update_progress(msg, pct):
        if progress_cb:
            progress_cb(msg, pct)
        
    update_progress("Calculating Feature Importance & EDA metrics...", 80)
    log("Calculating EDA metrics...")
    
    # 1. Mutual Information (Feature Importance)
    mi_sample_size = min(len(X_train_final), 2000)
    if mi_sample_size > 0:
        X_mi = X_train_final.sample(n=mi_sample_size, random_state=42)
        y_mi = y_train.loc[X_mi.index]
        mi_scores = mutual_info_regression(X_mi, y_mi, random_state=42)
        importance_scores = {}
        for col, score in zip(X_train_final.columns, mi_scores):
            importance_scores[col] = float(score)
        importance_scores = dict(sorted(importance_scores.items(), key=lambda item: item[1], reverse=True))
    else:
        importance_scores = {}
    
    # 2. Correlation Matrix
    update_progress("Generating correlation matrix & insights...", 92)
    top_features = list(importance_scores.keys())[:20]
    if top_features:
        heatmap_df = X_train_final[top_features].copy()
        heatmap_df[target_col] = y_train.values if hasattr(y_train, "values") else y_train
        corr_matrix = heatmap_df.corr().round(3).fillna(0).to_dict()
    else:
        corr_matrix = {}

    # 3. Target Correlations
    target_correlations = {}
    if not X_train_final.empty:
        for col in X_train_final.columns:
            try:
                # y_train might be a series or numpy array, but corr() works on Series
                val = float(X_train_final[col].corr(y_train))
                target_correlations[col] = 0.0 if np.isnan(val) else round(val, 3)
            except Exception:
                target_correlations[col] = 0.0

    return {
        "skewness_tracker": skewness_tracker,
        "correlation_matrix": corr_matrix,
        "importance_scores": importance_scores,
        "target_correlations": target_correlations,
        "total_features": len(X_train_final.columns)
    }


def imp(df, log=print, progress_cb=None):
    (
        X_train_cat, X_test_cat, X_train_cont, X_test_cont,
        y_train, y_test, categorical_cols, continuous_cols, target_col,
        original_shape, duplicates_removed, null_target_rows,
        columns_dropped_high_null, target_skewness, target_transform_applied, final_shape, index_cols_to_drop
    ) = imp_phase1(df, log=log, progress_cb=progress_cb)
    
    return imp_phase2(
        X_train_cat, X_test_cat, X_train_cont, X_test_cont,
        y_train, y_test, categorical_cols, continuous_cols, target_col,
        original_shape, duplicates_removed, null_target_rows,
        columns_dropped_high_null, target_skewness, target_transform_applied, final_shape,
        index_cols_to_drop=index_cols_to_drop, encoding_config=None, log=log, progress_cb=progress_cb
    )



def build_model_registry():
    """The 9-model tournament lineup (fresh instances, one dict per call)."""
    return {
        "OLS Linear Regression": LinearRegression(),
        "Ridge Regression": Ridge(random_state=42),
        "Lasso Regression": Lasso(random_state=42),
        "Elastic Net": ElasticNet(random_state=42),
        "Polynomial Regression (Degree 2)": make_pipeline(PolynomialFeatures(degree=2), Ridge(random_state=42)),
        "Decision Tree": DecisionTreeRegressor(random_state=42),
        "Random Forest": RandomForestRegressor(random_state=42, n_estimators=100),
        "Gradient Boosting (GBM)": GradientBoostingRegressor(random_state=42),
        "Support Vector Regression (SVR)": SVR(kernel='rbf')
    }


def recommendation_text_for(model_name):
    """Per-model recommendation text (same rules as the tournament suggestion engine)."""
    if model_name in ["Random Forest", "Gradient Boosting (GBM)"]:
        return f"Use {model_name}. The data contains complex, non-linear relationships."
    if model_name == "OLS Linear Regression":
        return "Use OLS Linear Regression. Your data is beautifully linear and clean."
    if model_name in ["Ridge Regression", "Lasso Regression", "Elastic Net"]:
        return f"Use {model_name}. This regularized model suppresses noise to give stable predictions."
    return f"Use {model_name}. It mathematically outperformed all other architectures."


def ultimate_model_selector(X_train_final, y_train, log=print, on_model_done=None, mode='standard'):
    """
    Evaluates 9 regression families and returns the leaderboard + un-trained winning model.

    Modes:
        'exhaustive' — Forces 5-Fold CV on all models regardless of dataset size.
        'standard'   — Dynamic CV degradation based on row count:
                        N ≤ 10,000  → 5-Fold CV
                        10K < N ≤ 50K → 3-Fold CV
                        N > 50,000  → Single 80/20 train/validation split
    """
    n_samples = len(X_train_final)

    # ── Determine evaluation strategy based on mode ──
    if mode == 'exhaustive':
        eval_strategy = '5-fold'
        kf = KFold(n_splits=5, shuffle=True, random_state=42)
        log("Execution Mode: EXHAUSTIVE (Forcing 5-Fold CV on all data).\n")
    else:
        # Standard mode — dynamic CV degradation
        if n_samples <= 10000:
            eval_strategy = '5-fold'
            kf = KFold(n_splits=5, shuffle=True, random_state=42)
        elif n_samples <= 50000:
            eval_strategy = '3-fold'
            kf = KFold(n_splits=3, shuffle=True, random_state=42)
        else:
            eval_strategy = 'single-split'
            kf = None  # Not used for single-split
        log("Execution Mode: STANDARD (Dynamic CV Degradation Activated).\n")

    strategy_label = {
        '5-fold': '5-Fold Cross Validation',
        '3-fold': '3-Fold Cross Validation',
        'single-split': 'Single 80/20 Train-Validation Split'
    }
    log(f"Initializing the Mega-Tournament ({strategy_label[eval_strategy]})...\n")

    # ── 1. Define the 9 Models ──
    models = build_model_registry()

    results = []

    # ── SVR safety guardrail (applies in BOTH modes) ──
    SVR_SUBSAMPLE_THRESHOLD = 10000
    SVR_SUBSAMPLE_SIZE = 5000

    # ── Pre-compute single-split data if needed ──
    if eval_strategy == 'single-split':
        X_split_train, X_split_val, y_split_train, y_split_val = train_test_split(
            X_train_final, y_train, test_size=0.20, random_state=42
        )
        log(f"  Single-split created: {len(X_split_train)} train / {len(X_split_val)} validation rows.\n")

    # ── 2. Train and Evaluate Loop ──
    for idx, (name, model) in enumerate(models.items()):

        # Determine the data to use for this model
        X_eval = X_train_final
        y_eval = y_train

        # SVR subsampling guard — active in ALL modes
        if 'SVR' in name and n_samples > SVR_SUBSAMPLE_THRESHOLD:
            rng = np.random.RandomState(42)
            sub_idx = rng.choice(n_samples, SVR_SUBSAMPLE_SIZE, replace=False)
            if isinstance(X_train_final, pd.DataFrame):
                X_eval = X_train_final.iloc[sub_idx]
            else:
                X_eval = X_train_final[sub_idx]
            if isinstance(y_train, pd.Series):
                y_eval = y_train.iloc[sub_idx]
            else:
                y_eval = y_train[sub_idx]
            log(f"  (SVR subsampled to {SVR_SUBSAMPLE_SIZE} rows for speed)")

        # Score the model using the determined strategy
        if eval_strategy == 'single-split':
            # For SVR with subsampling in single-split mode, we still do a
            # single fit on the split data (not the subsampled data).
            # But if SVR was subsampled, use subsampled data for the split too.
            if 'SVR' in name and n_samples > SVR_SUBSAMPLE_THRESHOLD:
                X_ss_train, X_ss_val, y_ss_train, y_ss_val = train_test_split(
                    X_eval, y_eval, test_size=0.20, random_state=42
                )
            else:
                X_ss_train, X_ss_val = X_split_train, X_split_val
                y_ss_train, y_ss_val = y_split_train, y_split_val

            from sklearn.base import clone
            model_clone = clone(model)
            model_clone.fit(X_ss_train, y_ss_train)
            val_predictions = model_clone.predict(X_ss_val)
            mean_r2 = r2_score(y_ss_val, val_predictions)
            std_r2 = 0.0
        else:
            # K-Fold CV path (5-fold or 3-fold)
            cv_scores = cross_val_score(model, X_eval, y_eval, cv=kf, scoring='r2', n_jobs=-1)
            mean_r2 = np.mean(cv_scores)
            std_r2 = np.std(cv_scores)

        results.append({
            "Model": name,
            "CV_R2_Mean": mean_r2,
            "CV_R2_Std": std_r2
        })
        log(f"Tested {name}: R2 = {mean_r2:.4f}")
        if on_model_done:
            on_model_done(name, idx + 1, len(models))

    # ── 3. Rank the Leaderboard ──
    leaderboard = pd.DataFrame(results)
    leaderboard = leaderboard.sort_values(by="CV_R2_Mean", ascending=False).reset_index(drop=True)
    
    # ── 4. The Automated Suggestion Engine ──
    best_model_name = leaderboard.loc[0, "Model"]
    best_score = leaderboard.loc[0, "CV_R2_Mean"]
    
    best_model_instance = models[best_model_name]
    
    log("\n" + "="*60)
    log("🏆 TOURNAMENT RESULTS 🏆")
    log("="*60)
    log(leaderboard.to_string())
    log("\n--- AUTOMATED USER RECOMMENDATION ---")
    
    if best_score < 0.30:
        recommendation_text = "CAUTION. None of the models performed well (Best R2 < 0.30)."
    else:
        recommendation_text = recommendation_text_for(best_model_name)
    
    log(f"Recommendation: {recommendation_text}")
    
    report = {
        "leaderboard": leaderboard,
        "recommendation": recommendation_text,
        "best_model_name": best_model_name
    }
        
    return leaderboard, best_model_instance, recommendation_text, report


def final_exam(winner_name, best_model, X_train, y_train, X_test, y_test, target_transform_applied, log=print):
    """
    Takes the winning algorithm from the tournament, trains it on the 
    entire training set, and tests it on the untouched Vault data.
    """
    log(f"\n{'='*60}")
    log(f"🚀 THE FINAL EXAM: Evaluating {winner_name} on the Vault Data 🚀")
    log(f"{'='*60}")
    
    # 1. Train the winning model on the full training set (with SVR protection for massive datasets)
    n_samples = len(X_train)
    SVR_SUBSAMPLE_THRESHOLD = 10000
    SVR_SUBSAMPLE_SIZE = 5000

    if 'SVR' in winner_name and n_samples > SVR_SUBSAMPLE_THRESHOLD:
        rng = np.random.RandomState(42)
        sub_idx = rng.choice(n_samples, SVR_SUBSAMPLE_SIZE, replace=False)
        if isinstance(X_train, pd.DataFrame):
            X_train_fit = X_train.iloc[sub_idx]
        else:
            X_train_fit = X_train[sub_idx]
        if isinstance(y_train, pd.Series):
            y_train_fit = y_train.iloc[sub_idx]
        else:
            y_train_fit = y_train[sub_idx]
        log(f"  (SVR subsampled to {SVR_SUBSAMPLE_SIZE} rows for final fit)")
        best_model.fit(X_train_fit, y_train_fit)
    else:
        best_model.fit(X_train, y_train)
    
    
    # 2. Unlock the Vault: Predict on the completely unseen test data
    final_predictions = best_model.predict(X_test)
    
    # NEW: Revert predictions and test data back to real-world units
    if target_transform_applied == "log1p":
        final_predictions = np.expm1(final_predictions)
        y_test_real = np.expm1(y_test)
    else:
        y_test_real = y_test

    # 3. Calculate True Real-World Metrics
    final_r2 = r2_score(y_test_real, final_predictions)
    final_rmse = np.sqrt(mean_squared_error(y_test_real, final_predictions))
    
    log(f"Final Real-World R-Squared: {final_r2:.4f}")
    log(f"Final Real-World RMSE:      {final_rmse:.4f}")
    
    if final_r2 > 0.70:
        verdict = "SUCCESS. The model generalizes beautifully to unseen data. It is ready for deployment!"
    else:
        verdict = "WARNING. The model struggled on unseen data. It may be overfitting or the data lacks strong signals."
    
    log(f"\nVerdict: {verdict}")

    # 4. Generate Visual Data Payload for Frontend
    # Subsample scatter data if too large to keep UI snappy
    max_scatter_points = 500
    n_points = len(y_test_real)
    
    if n_points > max_scatter_points:
        rng = np.random.RandomState(42)
        idx = rng.choice(n_points, max_scatter_points, replace=False)
        y_test_real_sample = y_test_real.iloc[idx] if isinstance(y_test_real, pd.Series) else y_test_real[idx]
        final_preds_sample = final_predictions[idx]
    else:
        y_test_real_sample = y_test_real
        final_preds_sample = final_predictions
        
    actuals = [round(float(v), 4) for v in np.array(y_test_real_sample)]
    preds = [round(float(v), 4) for v in np.array(final_preds_sample)]
    residuals = [round(float(a - p), 4) for a, p in zip(actuals, preds)]
    
    # Extract Feature Importances
    fi_labels = []
    fi_values = []
    if hasattr(best_model, 'feature_importances_'):
        importances = best_model.feature_importances_
        indices = np.argsort(importances)[-15:]
        fi_labels = X_train.columns[indices].tolist()
        fi_values = [float(v) for v in importances[indices]]
    elif hasattr(best_model, 'coef_'):
        importances = np.abs(best_model.coef_)
        if len(importances.shape) > 1:
            importances = importances[0]
        indices = np.argsort(importances)[-15:]
        fi_labels = X_train.columns[indices].tolist()
        fi_values = [float(v) for v in importances[indices]]

    final_metrics = {
        "final_r2": round(float(final_r2), 4),
        "final_rmse": round(float(final_rmse), 4),
        "verdict": verdict,
        "visuals": {
            "scatter_actual": actuals,
            "scatter_predicted": preds,
            "scatter_residuals": residuals,
            "fi_labels": fi_labels,
            "fi_values": fi_values
        }
    }
        
    return best_model, final_metrics

# ==========================================
# EXECUTION WORKFLOW
# ==========================================
import sys

if __name__ == "__main__":
    if len(sys.argv) > 1:
        a = sys.argv[1]
    else:
        a = input("Enter the name of the dataset file (e.g., data.csv): ")
    path = "./" + a
    
    try:
        df = pd.read_csv(path, encoding='unicode_escape')
        print("\nDataset loaded successfully. Beginning preprocessing pipeline...\n")
        
        # Step 1: Preprocess (Creates the Vault)
        X_train, X_test, y_train, y_test, _ = imp(df)
        
        # Step 2: The Tournament (Only uses Train)
        leaderboard, winning_model, _, _ = ultimate_model_selector(X_train, y_train)
        winning_name = leaderboard.loc[0, "Model"]
        
        # Step 3: The Final Exam (Unlocks the Vault)
        final_deployed_model, _ = final_exam(winning_name, winning_model, X_train, y_train, X_test, y_test, target_transform_applied=None)
        
    except FileNotFoundError:
        print(f"Error: Could not find the file '{a}' in the current directory.")
    except Exception as e:
        print(f"An error occurred during execution: {e}")