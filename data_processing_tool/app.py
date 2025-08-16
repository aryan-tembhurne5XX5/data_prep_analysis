import os
import base64
import io
import matplotlib
matplotlib.use('Agg')
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from flask import Flask, request, jsonify, render_template, send_from_directory
from sklearn.preprocessing import MinMaxScaler

# Initialize Flask App
app = Flask(__name__)
# Configure the upload folder
UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# --- Helper Functions ---
def get_data_insights(df):
    """Generates initial insights from the dataframe."""
    insights = {}
    buffer = io.StringIO()
    df.info(buf=buffer)
    insights['info'] = buffer.getvalue()
    insights['description'] = df.describe().to_html(classes='table table-striped table-bordered', header="true")
    missing_values = df.isnull().sum()
    insights['missing_values'] = missing_values[missing_values > 0].to_dict()
    return insights

# --- Flask Routes ---

@app.route('/')
def index():
    """Renders the main HTML page."""
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_file():
    """Handles CSV file upload and returns initial data insights."""
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    if file and file.filename.endswith('.csv'):
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], file.filename)
        file.save(filepath)
        try:
            df = pd.read_csv(filepath)
            insights = get_data_insights(df)
            numeric_cols = df.select_dtypes(include=np.number).columns.tolist()
            all_cols = df.columns.tolist()
            return jsonify({
                'filename': file.filename,
                'preview': df.head().to_html(classes='table table-striped table-bordered', header="true", index=False),
                'insights': insights,
                'columns': {'numeric': numeric_cols, 'all': all_cols}
            })
        except Exception as e:
            return jsonify({'error': f'Error processing file: {e}'}), 500
    return jsonify({'error': 'Invalid file type, please upload a CSV'}), 400

@app.route('/preprocess', methods=['POST'])
def preprocess_data():
    """Applies selected preprocessing steps to the data."""
    data = request.json
    filename = data.get('filename')
    actions = data.get('actions')
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    df = pd.read_csv(filepath)
    log = []

    if 'missing_values' in actions:
        for col, method in actions['missing_values'].items():
            if col in df.columns and df[col].isnull().sum() > 0:
                original_nan_count = df[col].isnull().sum()
                if method == 'mean': df[col].fillna(df[col].mean(), inplace=True)
                elif method == 'median': df[col].fillna(df[col].median(), inplace=True)
                elif method == 'mode': df[col].fillna(df[col].mode()[0], inplace=True)
                elif method == 'remove': df.dropna(subset=[col], inplace=True)
                log.append(f"✅ Handled {original_nan_count} missing values in '{col}' using {method}.")

    if 'outliers' in actions:
        for col in actions['outliers']:
            if col in df.select_dtypes(include=np.number).columns:
                Q1, Q3 = df[col].quantile(0.25), df[col].quantile(0.75)
                IQR = Q3 - Q1
                lower, upper = Q1 - 1.5 * IQR, Q3 + 1.5 * IQR
                outliers_count = ((df[col] < lower) | (df[col] > upper)).sum()
                if outliers_count > 0:
                    df[col] = np.clip(df[col], lower, upper)
                    log.append(f"✅ Capped {outliers_count} outliers in '{col}'.")

    if 'normalize' in actions:
        scaler = MinMaxScaler()
        for col in actions['normalize']:
            if col in df.select_dtypes(include=np.number).columns:
                df[[col]] = scaler.fit_transform(df[[col]])
                log.append(f"✅ Normalized '{col}' using Min-Max scaling.")

    cleaned_filename = 'cleaned_' + filename
    cleaned_filepath = os.path.join(app.config['UPLOAD_FOLDER'], cleaned_filename)
    df.to_csv(cleaned_filepath, index=False)
    
    return jsonify({
        'log': log,
        'cleaned_filename': cleaned_filename,
        'preview': df.head().to_html(classes='table table-striped table-bordered', header="true", index=False)
    })

@app.route('/analyze', methods=['POST'])
def analyze_data():
    """Generates a plot and stats for a selected column. Now with robust error handling."""
    try:
        data = request.json
        filename = data.get('filename')
        column = data.get('column')
        plot_type = data.get('plot_type')

        if not all([filename, column, plot_type]):
            return jsonify({'error': 'Missing required parameters (filename, column, or plot_type).'}), 400

        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        df = pd.read_csv(filepath)

        if column not in df.columns:
            return jsonify({'error': f"Column '{column}' not found in the dataset."}), 400

        # --- Generate Stats ---
        stats = {}
        if pd.api.types.is_numeric_dtype(df[column]):
            stats.update({
                'Count': f"{df[column].count():,}", 'Mean (Average)': f"{df[column].mean():,.2f}",
                'Total (Sum)': f"{df[column].sum():,.2f}", 'Median': f"{df[column].median():,.2f}",
                'Std Deviation': f"{df[column].std():,.2f}"
            })
        else:
            stats.update({
                'Count': f"{df[column].count():,}", 'Unique Values': f"{df[column].nunique():,}",
                'Top Value': str(df[column].mode()[0])
            })

        # --- Generate Plot ---
        plt.figure(figsize=(10, 6))
        sns.set_theme(style="whitegrid")
        if plot_type == 'histogram': sns.histplot(df[column], kde=True, color='#2563eb')
        elif plot_type == 'boxplot': sns.boxplot(x=df[column], color='#34d399')
        elif plot_type == 'count':
            order = df[column].value_counts().iloc[:15].index
            sns.countplot(y=df[column], order=order, palette='viridis')
        
        plt.title(f'{plot_type.capitalize()} Plot of {column}', fontsize=16)
        plt.xlabel(column, fontsize=12); plt.ylabel(''); plt.tight_layout()
        
        buf = io.BytesIO()
        plt.savefig(buf, format='png'); buf.seek(0)
        img_base64 = base64.b64encode(buf.read()).decode('utf-8')
        plt.close()
        
        return jsonify({'image': img_base64, 'stats': stats})

    except FileNotFoundError:
        return jsonify({'error': f"File '{filename}' not found on server. Please try re-uploading."}), 404
    except Exception as e:
        print(f"An error occurred during analysis: {e}") # For server-side debugging
        return jsonify({'error': f'An unexpected server error occurred: {str(e)}'}), 500


@app.route('/download/<path:filename>')
def download_file(filename):
    """Serves the cleaned file for download."""
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename, as_attachment=True)

if __name__ == '__main__':
    app.run(debug=True)