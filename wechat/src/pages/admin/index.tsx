import { View, Text, Input, Button, Image } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useState, useEffect } from "react";
import { BRAND_NAME, BRAND_LOGO, BRAND_SLOGAN } from "../../shared/brand";
import { getToken } from "../../shared/auth";
import "./index.scss";

interface BrandConfig {
  brandName: string;
  brandLogo: string;
  brandSlogan: string;
}

export default function AdminPage() {
  const [form, setForm] = useState<BrandConfig>({
    brandName: BRAND_NAME,
    brandLogo: BRAND_LOGO,
    brandSlogan: BRAND_SLOGAN,
  });
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    setFetching(true);
    try {
      const token = getToken();
      const API_BASE =
        process.env.TARO_APP_API_BASE || "https://expert-network.vercel.app";
      const res = await Taro.request({
        url: `${API_BASE}/api/admin/brand`,
        method: "GET",
        header: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.statusCode === 200 && res.data) {
        const d = res.data as Partial<BrandConfig>;
        setForm({
          brandName: d.brandName ?? BRAND_NAME,
          brandLogo: d.brandLogo ?? BRAND_LOGO,
          brandSlogan: d.brandSlogan ?? BRAND_SLOGAN,
        });
      }
    } catch {
      // Use build-time defaults if API fails
    } finally {
      setFetching(false);
    }
  };

  const saveConfig = async () => {
    if (!form.brandName.trim()) {
      Taro.showToast({ title: "请输入品牌名称", icon: "none" });
      return;
    }
    setLoading(true);
    try {
      const token = getToken();
      const API_BASE =
        process.env.TARO_APP_API_BASE || "https://expert-network.vercel.app";
      const res = await Taro.request({
        url: `${API_BASE}/api/admin/brand`,
        method: "PUT",
        header: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        data: form,
      });
      if (res.statusCode === 200) {
        Taro.showToast({ title: "保存成功", icon: "success" });
      } else {
        Taro.showToast({ title: "保存失败", icon: "none" });
      }
    } catch {
      Taro.showToast({ title: "网络错误", icon: "none" });
    } finally {
      setLoading(false);
    }
  };

  if (fetching) {
    return (
      <View className="admin__loading">
        <Text>加载中...</Text>
      </View>
    );
  }

  return (
    <View className="admin">
      <View className="admin__header">
        <Text className="admin__title">品牌配置</Text>
        <Text className="admin__subtitle">
          {process.env.TARO_APP_REGION === "cn" ? "国内版" : "海外版"}
        </Text>
      </View>

      {/* Live preview */}
      <View className="admin__preview">
        <View className="admin__preview-card">
          {form.brandLogo ? (
            <Image src={form.brandLogo} className="admin__preview-logo" />
          ) : null}
          <Text className="admin__preview-name">{form.brandName}</Text>
          <Text className="admin__preview-slogan">{form.brandSlogan}</Text>
        </View>
      </View>

      <View className="admin__form">
        <View className="admin__field">
          <Text className="admin__label">品牌名称</Text>
          <Input
            className="admin__input"
            value={form.brandName}
            onInput={(e) => setForm((f) => ({ ...f, brandName: e.detail.value }))}
            placeholder="Help & Grow"
          />
        </View>

        <View className="admin__field">
          <Text className="admin__label">Logo 图片 URL</Text>
          <Input
            className="admin__input"
            value={form.brandLogo}
            onInput={(e) => setForm((f) => ({ ...f, brandLogo: e.detail.value }))}
            placeholder="https://..."
          />
        </View>

        <View className="admin__field">
          <Text className="admin__label">品牌口号</Text>
          <Input
            className="admin__input"
            value={form.brandSlogan}
            onInput={(e) => setForm((f) => ({ ...f, brandSlogan: e.detail.value }))}
            placeholder="AI Native Expert Network"
          />
        </View>

        <Button
          className="admin__save-btn"
          onClick={saveConfig}
          loading={loading}
          disabled={loading}
        >
          保存配置
        </Button>
      </View>
    </View>
  );
}
