import { useState, useEffect } from 'react';
import AnonymizerTab from '../components/AnonymizerTab';
import VectorDBBuilder from '../components/VectorDBBuilder'; 
import ThemeReranker from '../components/ThemeReranker';
import InsightGenerator from '../components/InsightGenerator';
import QueryTab from '../components/QueryTab';

export default function PipelineDemo() {
  const [activeTab, setActiveTab] = useState('anonymize');
  const [isAnonymized, setIsAnonymized] = useState(false);
  const [, setVectorDbReady] = useState(false);
  const [isProcessing] = useState(false);

  // Check backend for existing anonymized CSV / vector DB and enable steps if present
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch('http://localhost:5001/api/status');
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

  const steps = [
    { id: 'anonymize', title: '1. Anonymize Data', icon: '🔒', enabled: true },
    { id: 'vectors', title: '2. Build Vector DB', icon: '🗄️', enabled: true },
    { id: 'rerank', title: '3. Rerank Themes', icon: '🎯', enabled: true },
    { id: 'insights', title: '4. Generate Insights', icon: '🧠', enabled: true },
    { id: 'query', title: '5. AI Query', icon: '✨', enabled: true },
  ];

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Data Pipeline</h1>
          <p className="mt-2 text-sm text-gray-500">
            Securely anonymize feedback, vectorize the text, and query using AI.
          </p>
          {isProcessing && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-300 rounded-lg flex items-center">
              <div className="animate-spin mr-3 text-xl">⏳</div>
              <span className="text-blue-700 font-medium">Processing in backend...</span>
            </div>
          )}
        </div>

        {/* Navigation Tabs */}
        <nav className="flex space-x-4 border-b border-gray-200 pb-px" aria-label="Tabs">
          {steps.map((step) => (
            <button
              key={step.id}
              onClick={() => setActiveTab(step.id)}
              disabled={isProcessing}
              className={`
                flex items-center px-6 py-3 text-sm font-medium rounded-t-lg transition-colors
                ${activeTab === step.id 
                  ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600' 
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}
                ${isProcessing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              <span className="mr-2 text-lg">{step.icon}</span>
              {step.title}
            </button>
          ))}
        </nav>

        {/* Content Area */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 min-h-[500px]">
          {activeTab === 'anonymize' && (
            <AnonymizerTab existingAnonymized={isAnonymized} onComplete={() => {
              setIsAnonymized(true);
            }} />
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
