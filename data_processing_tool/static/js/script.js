document.addEventListener('DOMContentLoaded', function() {
    // --- STATE MANAGEMENT ---
    let currentFilename = null;
    let currentCleanedFilename = null;
    let columns = {};

    // --- DOM ELEMENT SELECTORS ---
    const uploadForm = document.getElementById('upload-form');
    const mainContent = document.getElementById('main-content');
    const loader = document.getElementById('loader');
    const uploadError = document.getElementById('upload-error');
    const columnSelect = document.getElementById('column-select');
    const plotTypeSelect = document.getElementById('plot-type-select');
    const downloadContainer = document.getElementById('download-container');
    const downloadLink = document.getElementById('download-link');

    // --- EVENT LISTENERS ---

    // 1. Handle File Upload
    uploadForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        const formData = new FormData(this);
        
        showLoader(loader, true);
        mainContent.style.display = 'none';
        uploadError.textContent = '';
        downloadContainer.style.display = 'none'; // Hide download button on new upload

        try {
            const response = await fetch('/upload', { method: 'POST', body: formData });
            if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            
            currentFilename = data.filename;
            currentCleanedFilename = data.filename;
            columns = data.columns;
            
            displayInitialData(data);
            mainContent.style.display = 'block';

        } catch (error) {
            uploadError.textContent = `Upload failed: ${error.message}`;
        } finally {
            showLoader(loader, false);
        }
    });

    // 2. Handle Preprocessing Actions
    document.getElementById('preprocess-btn').addEventListener('click', async function() {
        const preprocessLoader = document.getElementById('preprocess-loader');
        const logContainer = document.getElementById('preprocess-log');
        
        showLoader(preprocessLoader, true);
        logContainer.innerHTML = '';
        downloadContainer.style.display = 'none';
        
        const actions = { missing_values: {}, outliers: [], normalize: [] };
        document.querySelectorAll('.missing-value-select').forEach(s => { if (s.value !== 'none') actions.missing_values[s.dataset.column] = s.value; });
        document.querySelectorAll('.outlier-checkbox:checked').forEach(c => actions.outliers.push(c.dataset.column));
        document.querySelectorAll('.normalize-checkbox:checked').forEach(c => actions.normalize.push(c.dataset.column));

        try {
            const response = await fetch('/preprocess', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: currentFilename, actions: actions })
            });
            const data = await response.json();
            if (data.error) throw new Error(data.error);

            currentCleanedFilename = data.cleaned_filename;
            logContainer.innerHTML = data.log.map(item => `<div>${item}</div>`).join('');
            document.getElementById('data-preview').innerHTML = data.preview;
            
            // Show download button
            downloadLink.href = `/download/${data.cleaned_filename}`;
            downloadContainer.style.display = 'block';

        } catch (error) {
            logContainer.innerHTML = `<div class="error-message">Preprocessing failed: ${error.message}</div>`;
        } finally {
            showLoader(preprocessLoader, false);
        }
    });

    // 3. Handle Analysis & Visualization (with improved error handling)
    document.getElementById('analyze-btn').addEventListener('click', async function() {
        const analysisLoader = document.getElementById('analysis-loader');
        const resultsContainer = document.getElementById('analysis-results-container');
        const plotResult = document.getElementById('plot-result');
        const statsResult = document.getElementById('stats-result');
        
        showLoader(analysisLoader, true);
        resultsContainer.style.display = 'none';
        plotResult.innerHTML = '';
        statsResult.innerHTML = '';

        try {
            const response = await fetch('/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    filename: currentCleanedFilename, 
                    column: columnSelect.value,
                    plot_type: plotTypeSelect.value 
                })
            });
            
            const data = await response.json();
            // Check if the server responded with an error status code
            if (!response.ok) {
                throw new Error(data.error || `Server responded with status: ${response.status}`);
            }

            plotResult.innerHTML = `<img src="data:image/png;base64,${data.image}" alt="Analysis Plot">`;

            let statsHtml = `<h4>Statistics for ${columnSelect.value}</h4>`;
            for (const [key, value] of Object.entries(data.stats)) {
                statsHtml += `<div class="stat-item"><span>${key}</span><span>${value}</span></div>`;
            }
            statsResult.innerHTML = statsHtml;
            resultsContainer.style.display = 'grid';

        } catch (error) {
            resultsContainer.style.display = 'grid'; // Use grid to keep layout consistent
            plotResult.innerHTML = `<div class="error-message">Analysis Failed</div>`;
            statsResult.innerHTML = `<div class="stat-item"><span>Error</span><span>${error.message}</span></div>`;
        } finally {
            showLoader(analysisLoader, false);
        }
    });

    // 4. Update plot options based on selected column type
    columnSelect.addEventListener('change', function() { updatePlotOptions(this.value); });

    // --- UI HELPER FUNCTIONS ---
    function displayInitialData(data) {
        document.getElementById('filename-display').textContent = data.filename;
        document.getElementById('data-preview').innerHTML = data.preview;
        document.getElementById('data-description').innerHTML = data.insights.description;
        document.getElementById('data-info').textContent = data.insights.info;
        populatePreprocessingTools(columns);
        columnSelect.innerHTML = columns.all.map(col => `<option value="${col}">${col}</option>`).join('');
        updatePlotOptions(columnSelect.value);
    }

    function populatePreprocessingTools(cols) {
        const missingContainer = document.getElementById('missing-values-options');
        const outlierContainer = document.getElementById('outlier-options');
        const normalizeContainer = document.getElementById('normalize-options');
        missingContainer.innerHTML = ''; outlierContainer.innerHTML = ''; normalizeContainer.innerHTML = '';

        cols.all.forEach(col => {
            const isNumeric = cols.numeric.includes(col);
            missingContainer.innerHTML += `
                <div class="option-group">
                    <label>${col}</label>
                    <select class="missing-value-select" data-column="${col}">
                        <option value="none">None</option>
                        ${isNumeric ? `<option value="mean">Fill with Mean</option><option value="median">Fill with Median</option>` : ''}
                        <option value="mode">Fill with Mode</option>
                        <option value="remove">Remove Row</option>
                    </select>
                </div>`;
            if (isNumeric) {
                outlierContainer.innerHTML += `<div class="checkbox-group"><input type="checkbox" id="outlier-${col}" class="outlier-checkbox" data-column="${col}"><label for="outlier-${col}">${col}</label></div>`;
                normalizeContainer.innerHTML += `<div class="checkbox-group"><input type="checkbox" id="norm-${col}" class="normalize-checkbox" data-column="${col}"><label for="norm-${col}">${col}</label></div>`;
            }
        });
    }

    function updatePlotOptions(selectedColumn) {
        plotTypeSelect.innerHTML = columns.numeric.includes(selectedColumn)
            ? `<option value="histogram">Histogram</option><option value="boxplot">Box Plot</option>`
            : `<option value="count">Count Plot</option>`;
    }

    function showLoader(element, show) {
        element.style.display = show ? 'block' : 'none';
    }
});
