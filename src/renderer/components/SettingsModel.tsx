import { Column, TableView, Row } from "./TableView";
import { Progress } from "./Progress";
import React, { useState } from "react";
import { useSharedState } from "../contexts/SharedStateContext";
import { clippyApi } from "../clippyApi";
import { prettyDownloadSpeed } from "../helpers/convert-download-speed";
import { ManagedModel } from "../../models";
import { isModelDownloading } from "../../helpers/model-helpers";

export const SettingsModel: React.FC = () => {
  const { models, settings } = useSharedState();
  const modelKeys = Object.keys(models || {});

  // Track selection by model name rather than array index to prevent mismatches
  const [selectedModelName, setSelectedModelName] = useState<string>(() => {
    return settings.selectedModel || modelKeys[0] || "Gemma 3 (1B)";
  });

  const columns: Array<Column> = [
    { key: "default", header: "Loaded", width: 50 },
    { key: "name", header: "Name" },
    {
      key: "size",
      header: "Size",
      render: (row) =>
        `${(row.size as number)?.toLocaleString?.() ?? row.size} MB`,
    },
    { key: "company", header: "Company" },
    { key: "downloaded", header: "Downloaded" },
  ];

  const data = modelKeys.map((modelKey) => {
    const model = models?.[modelKey as keyof typeof models];
    const isDownloading = isModelDownloading(model);
    const pct = Math.round(model?.downloadState?.percentComplete || 0);

    let downloadedLabel = "No";
    if (model?.downloaded) {
      downloadedLabel = "Yes";
    } else if (isDownloading) {
      downloadedLabel = `Downloading (${pct}%)`;
    }

    return {
      default: model?.name === settings.selectedModel ? "ｘ" : "",
      name: model?.name,
      company: model?.company,
      size: model?.size,
      downloaded: downloadedLabel,
    };
  });

  // Effective selected model (fallback gracefully)
  const effectiveModelName =
    selectedModelName && models?.[selectedModelName]
      ? selectedModelName
      : settings.selectedModel && models?.[settings.selectedModel]
        ? settings.selectedModel
        : modelKeys[0] || "";

  const selectedModel = models?.[effectiveModelName] || null;
  const isDownloading = isModelDownloading(selectedModel);
  const isDefaultModel = selectedModel?.name === settings.selectedModel;

  // Check if any model is downloading in the background
  const activeDownloadingModel = Object.values(models || {}).find((m) =>
    isModelDownloading(m),
  );

  // Index in data for initial selection highlight in TableView
  const selectedIndex = data.findIndex(
    (row) => row.name === selectedModel?.name,
  );

  // Handlers
  // ---------------------------------------------------------------------------
  const handleRowSelect = (_index: number, row?: Row) => {
    if (row && typeof row.name === "string") {
      setSelectedModelName(row.name);
    }
  };

  const handleDownload = async () => {
    if (selectedModel?.name) {
      await clippyApi.downloadModelByName(selectedModel.name);
    }
  };

  const handleCancelDownload = async (modelName?: string) => {
    const target = modelName || selectedModel?.name;
    if (target) await clippyApi.cancelDownloadByName(target);
  };

  const handleDeleteOrRemove = async () => {
    if (selectedModel?.imported) {
      await clippyApi.removeModelByName(selectedModel.name);
    } else if (selectedModel) {
      await clippyApi.deleteModelByName(selectedModel.name);
    }
  };

  const handleMakeDefault = async () => {
    if (selectedModel?.name) {
      clippyApi.setState("settings.selectedModel", selectedModel.name);
    }
  };

  return (
    <div>
      <p>
        Select the model you want to use for your chat. The larger the model,
        the more powerful the chat, but the slower it will be - and the more
        memory it will use. Clippy uses models in the GGUF format.{" "}
        <a
          href="https://github.com/felixrieseberg/clippy?tab=readme-ov-file#downloading-more-models"
          target="_blank"
        >
          More information.
        </a>
      </p>

      <button
        style={{ marginBottom: 10 }}
        onClick={() => clippyApi.addModelFromFile()}
      >
        Add model from file
      </button>
      <TableView
        columns={columns}
        data={data}
        onRowSelect={handleRowSelect}
        initialSelectedIndex={selectedIndex !== -1 ? selectedIndex : 0}
      />

      {selectedModel && (
        <div
          className="model-details sunken-panel"
          style={{ marginTop: "20px", padding: "15px" }}
        >
          <strong>{selectedModel.name}</strong>

          {selectedModel.description && <p>{selectedModel.description}</p>}

          {selectedModel.homepage && (
            <p>
              <a
                href={selectedModel.homepage}
                target="_blank"
                rel="noopener noreferrer"
              >
                Visit Homepage
              </a>
            </p>
          )}

          <div style={{ marginTop: "15px", display: "flex", gap: "10px" }}>
            {!selectedModel.downloaded ? (
              <>
                {!isDownloading ? (
                  <button onClick={handleDownload}>Download Model</button>
                ) : (
                  <button onClick={() => handleCancelDownload()}>
                    Cancel Download
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  disabled={isDownloading || isDefaultModel}
                  onClick={handleMakeDefault}
                >
                  {isDefaultModel
                    ? "Clippy uses this model"
                    : "Make Clippy use this model"}
                </button>
                <button onClick={handleDeleteOrRemove}>
                  {selectedModel?.imported ? "Remove" : "Delete"} Model
                </button>
              </>
            )}
          </div>
          <SettingsModelDownload
            model={selectedModel}
            onCancel={() => handleCancelDownload(selectedModel.name)}
          />
        </div>
      )}

      {/* If another model is downloading in the background, show its progress too */}
      {activeDownloadingModel &&
        activeDownloadingModel.name !== selectedModel?.name && (
          <div
            className="sunken-panel"
            style={{
              marginTop: "12px",
              padding: "10px",
              backgroundColor: "#f4f4f4",
            }}
          >
            <div style={{ marginBottom: "6px" }}>
              <strong>Downloading in background:</strong>{" "}
              {activeDownloadingModel.name}
            </div>
            <SettingsModelDownload
              model={activeDownloadingModel}
              onCancel={() => handleCancelDownload(activeDownloadingModel.name)}
            />
          </div>
        )}
    </div>
  );
};

const SettingsModelDownload: React.FC<{
  model?: ManagedModel;
  onCancel?: () => void;
}> = ({ model, onCancel }) => {
  if (!model || !isModelDownloading(model)) {
    return null;
  }

  const percent = Math.min(
    100,
    Math.max(0, Math.round(model.downloadState?.percentComplete || 0)),
  );
  const downloadSpeed = prettyDownloadSpeed(
    model.downloadState?.currentBytesPerSecond || 0,
  );

  const receivedBytes = model.downloadState?.receivedBytes;
  const totalBytes = model.downloadState?.totalBytes;
  let byteProgressText = "";
  if (receivedBytes !== undefined && totalBytes && totalBytes > 0) {
    const receivedMB = (receivedBytes / (1024 * 1024)).toFixed(1);
    const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
    byteProgressText = `${receivedMB} MB / ${totalMB} MB`;
  }

  return (
    <div style={{ marginTop: "15px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: "4px",
          fontSize: "11px",
        }}
      >
        <span>Downloading {model.name}...</span>
        <span>
          {byteProgressText ? `${byteProgressText} · ` : ""}
          {downloadSpeed}/s · {percent}%
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <div style={{ flexGrow: 1 }}>
          <Progress progress={percent} />
        </div>
        {onCancel && (
          <button
            style={{
              minWidth: "60px",
              height: "20px",
              padding: "0 6px",
              fontSize: "11px",
            }}
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
};
