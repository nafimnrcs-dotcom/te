import { useRef, useState } from 'react';
import { FileTransfer as FileTransferType } from '../utils/webrtc';
import { Upload, File, Download } from 'lucide-react';

interface FileTransferProps {
  fileTransfers: FileTransferType[];
  onFileSelect: (file: File) => void;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export function FileTransfer({ fileTransfers, onFileSelect }: FileTransferProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setError(null);
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`${API_URL}/api/files/upload`, {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          throw new Error('Upload failed');
        }

        const result = await response.json();
        console.log('File uploaded:', result);
        onFileSelect(file);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed');
        console.error('Upload error:', err);
      } finally {
        setUploading(false);
        e.target.value = '';
      }
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="p-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold mb-3">File Transfers</h3>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Upload className="w-5 h-5" />
          {uploading ? 'Uploading...' : 'Share File'}
        </button>
        {error && (
          <div className="mt-2 text-sm text-red-600 bg-red-50 p-2 rounded">
            {error}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileChange}
          className="hidden"
          disabled={uploading}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {fileTransfers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <File className="w-16 h-16 mb-2" />
            <p>No file transfers yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {fileTransfers.map(transfer => (
              <FileTransferItem key={transfer.id} transfer={transfer} formatFileSize={formatFileSize} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface FileTransferItemProps {
  transfer: FileTransferType;
  formatFileSize: (bytes: number) => string;
}

function FileTransferItem({ transfer, formatFileSize }: FileTransferItemProps) {
  return (
    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-blue-100 rounded">
          <Download className="w-5 h-5 text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-gray-900 truncate">{transfer.name}</p>
          <p className="text-sm text-gray-500">
            From: {transfer.peerName}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {formatFileSize(transfer.size)}
          </p>
          {transfer.progress > 0 && (
            <div className="mt-2">
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all"
                  style={{ width: `${transfer.progress}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">{transfer.progress}%</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
