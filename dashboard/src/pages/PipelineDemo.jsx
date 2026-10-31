import { useState, useEffect } from 'react';
import AnonymizerTab from '../components/AnonymizerTab';
import VectorDBBuilder from '../components/VectorDBBuilder'; 
import ThemeReranker from '../components/ThemeReranker';
import InsightGenerator from '../components/InsightGenerator';
import QueryTab from '../components/QueryTab';
import { apiUrl } from '../services/api';
import { useI18n } from '../i18n/I18nProvider';
import Icon from '../components/Icon';
import { PIPELINE_STEPS } from '../config/pipelineSteps';

export default function PipelineDemo() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState('anonymize');
  const [isAnonymized, setIsAnonymized] = useState(false);
  const [, setVectorDbReady] = useState(false);
  const [isProcessing] = useState(false);

  // Check backend for existing anonymized CSV / vector DB and enable steps if present
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch(apiUrl('/api/status'));
        const data = await res.json();
        if (data.status === 'success') {
          setIsAnonymized(Boolean(data.anonymized_exists));
          setVectorDbReady(Boolean(data.vector_db_exists));
        }
      } catch (e) {
        console.warn('Failed to fetch status:', e);
      }
    };
    checkStatus();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">{t('page.title')}</h1>
          <p className="mt-2 text-sm text-gray-500">
            {t('page.lead')}
          </p>
          {isProcessing && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-300 rounded-lg flex items-center">
              <Icon name="progress_activity" className="animate-spin mr-3 text-xl" />
              <span className="text-blue-700 font-medium">{t('state.working')}</span>
            </div>
          )}
        </div>

        {/* Navigation Tabs */}
        <nav className="flex space-x-4 border-b border-gray-200 pb-px overflow-x-auto" aria-label="Tabs">
          {PIPELINE_STEPS.map((step) => (
            <button
              key={step.id}
              onClick={() => setActiveTab(step.id)}
              disabled={isProcessing}
              className={`
                flex items-center shrink-0 px-4 sm:px-6 py-3 text-sm font-medium rounded-t-lg transition-colors
                ${activeTab === step.id 
                  ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600' 
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}
                ${isProcessing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              <Icon name={step.icon} className="mr-2 text-lg" />
              {step.n}. {t('step.' + step.id)}
            </button>
          ))}
        </nav>

        {/* Content Area */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 sm:p-8 min-h-[500px]">
          {activeTab === 'anonymize' && (
            <AnonymizerTab
              existingAnonymized={isAnonymized}
              onNavigate={setActiveTab}
              onComplete={() => {
                setIsAnonymized(true);
              }}
            />
          )}
          
          {activeTab === 'vectors' && (
            <VectorDBBuilder 
              onSuccess={() => {
                setVectorDbReady(true);
                setActiveTab('rerank');
              }} 
            />
          )}

          {activeTab === 'rerank' && (
            <ThemeReranker
              onSuccess={() => {
                setActiveTab('insights');
              }}
            />
          )}
          
          {activeTab === 'insights' && (
             <InsightGenerator onComplete={() => setActiveTab('query')} />
          )}
          
          {activeTab === 'query' && (
            <QueryTab />
          )}
        </div>

      </div>
    </div>
  );
}
