import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, Switch, Button, Select, Alert, Space, Typography } from 'antd';
import { Sparkles, CheckCircle2, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { getAiSettings, saveAiSettings, testAiSettings } from '../api/client';

const { Text } = Typography;

const PRESETS = {
  gemini: {
    label: 'Google Gemini (Free)',
    base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
  },
  ollama: {
    label: 'Ollama (Local)',
    base_url: 'http://localhost:11434/v1',
    model: 'qwen2.5-coder',
  },
  deepseek: {
    label: 'DeepSeek',
    base_url: 'https://api.deepseek.com/v1',
    model: 'deepseek-coder',
  },
  custom: {
    label: 'Tùy chỉnh (OpenAI Compatible)',
    base_url: '',
    model: '',
  }
};

export default function AiSettingsModal({ open, onClose }) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [hasKey, setHasKey] = useState(false);
  
  const selectedPreset = Form.useWatch('preset', form);

  useEffect(() => {
    if (open) {
      setTestResult(null);
      setLoading(true);
      getAiSettings()
        .then(res => {
          const data = res.data;
          setHasKey(data.has_key);
          
          // Determine preset
          let preset = 'custom';
          for (const [k, v] of Object.entries(PRESETS)) {
            if (k !== 'custom' && v.base_url === data.base_url) {
              preset = k;
              break;
            }
          }
          
          form.setFieldsValue({
            preset,
            ai_base_url: data.base_url,
            ai_model: data.model,
            ai_enabled: data.enabled,
            ai_api_key: '', // Don't show actual key
          });
        })
        .catch(err => {
          console.error(err);
          toast.error("Không thể tải cấu hình AI");
        })
        .finally(() => setLoading(false));
    }
  }, [open, form]);

  const handlePresetChange = (presetKey) => {
    if (presetKey !== 'custom') {
      form.setFieldsValue({
        ai_base_url: PRESETS[presetKey].base_url,
        ai_model: PRESETS[presetKey].model,
      });
    }
    setTestResult(null);
  };

  const handleTest = async () => {
    try {
      const values = await form.validateFields();
      setTesting(true);
      setTestResult(null);
      
      // Save temp first to test
      await saveAiSettings({
        ai_base_url: values.ai_base_url,
        ai_model: values.ai_model,
        ai_api_key: values.ai_api_key || null, // send null if empty to keep old key
        ai_enabled: values.ai_enabled,
      });

      const res = await testAiSettings();
      setTestResult({ success: true, message: res.data.message });
      setHasKey(true); // If test passed, we definitely have a key
    } catch (err) {
      setTestResult({ success: false, message: err.message || "Kết nối thất bại" });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      
      await saveAiSettings({
        ai_base_url: values.ai_base_url,
        ai_model: values.ai_model,
        ai_api_key: values.ai_api_key || null,
        ai_enabled: values.ai_enabled,
      });
      
      toast.success("Đã lưu cấu hình AI");
      onClose();
    } catch (err) {
      if (err.name !== 'ValidationError') {
        toast.error("Lỗi: " + (err.message || "Không thể lưu"));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={
        <Space>
          <Sparkles size={20} color="var(--accent-primary)" />
          <span style={{ fontWeight: 600 }}>Cài đặt AI Assistant (Ctrl+I)</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      onOk={handleSave}
      confirmLoading={loading}
      okText="Lưu lại"
      cancelText="Hủy"
      width={500}
      styles={{ body: { paddingTop: 16 } }}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          ai_enabled: true,
          preset: 'gemini',
          ai_base_url: PRESETS.gemini.base_url,
          ai_model: PRESETS.gemini.model,
        }}
      >
        <Form.Item name="ai_enabled" valuePropName="checked">
          <Switch checkedChildren="Đã bật AI" unCheckedChildren="Đã tắt AI" />
        </Form.Item>

        <Form.Item label="Nhà cung cấp (Preset)" name="preset">
          <Select onChange={handlePresetChange}>
            {Object.entries(PRESETS).map(([k, v]) => (
              <Select.Option key={k} value={k}>{v.label}</Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          label="Base URL (OpenAI Compatible)"
          name="ai_base_url"
          rules={[{ required: true, message: 'Vui lòng nhập Base URL' }]}
        >
          <Input placeholder="VD: https://api.openai.com/v1" />
        </Form.Item>

        <Form.Item
          label="Tên Model"
          name="ai_model"
          rules={[{ required: true, message: 'Vui lòng nhập Tên Model' }]}
        >
          <Input placeholder="VD: gpt-4o-mini" />
        </Form.Item>

        <Form.Item
          label={
            <span>
              API Key 
              {hasKey && <Text type="success" style={{ marginLeft: 8, fontSize: '0.8rem' }}>(Đã lưu sẵn)</Text>}
            </span>
          }
          name="ai_api_key"
          rules={[{ required: !hasKey && selectedPreset !== 'ollama', message: 'Vui lòng nhập API Key' }]}
          extra={selectedPreset === 'ollama' ? "Ollama thường không yêu cầu API Key." : "Để trống nếu không muốn thay đổi Key đã lưu."}
        >
          <Input.Password placeholder={hasKey ? "Nhập key mới để thay đổi..." : "Nhập API Key..."} />
        </Form.Item>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <Button onClick={handleTest} loading={testing} disabled={loading}>
            Kiểm tra kết nối
          </Button>
          
          {testResult && (
            <Space style={{ color: testResult.success ? '#52c41a' : '#ff4d4f' }}>
              {testResult.success ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              <Text style={{ color: 'inherit', fontSize: '0.9rem' }}>{testResult.message}</Text>
            </Space>
          )}
        </div>
      </Form>
    </Modal>
  );
}
