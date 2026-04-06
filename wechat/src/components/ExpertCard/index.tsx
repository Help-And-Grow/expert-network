import { View, Text } from "@tarojs/components";
import Taro from "@tarojs/taro";
import type { Expert } from "../../shared/types";
import { getDomainLabel } from "../../shared/types";
import "./index.scss";

interface Props {
  expert: Expert;
}

export default function ExpertCard({ expert }: Props) {
  const name = expert.user.nickName || expert.user.name || "成员";
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const minPrice = Math.min(
    expert.priceOnlineCents || Infinity,
    expert.priceOfflineCents || Infinity
  );

  const goToProfile = () => {
    Taro.navigateTo({ url: `/pages/expert/index?id=${expert.id}` });
  };

  const goToBook = () => {
    Taro.navigateTo({ url: `/pages/book/index?id=${expert.id}&from=browse` });
  };

  return (
    <View className="expert-card" hoverClass="expert-card--hover" onClick={goToProfile}>
      <View className="expert-card__body">
        <View className="expert-card__avatar">{initials}</View>
        <View className="expert-card__info">
          <View className="expert-card__header">
            <View className="expert-card__name-row">
              <Text className="expert-card__name">{name}</Text>
              {expert.isVerified && (
                <View className="expert-card__badge expert-card__badge--verified">
                  ✓
                </View>
              )}
            </View>
            {minPrice !== Infinity && (
              <Text className="expert-card__price">
                SGD {Math.round(minPrice / 100)}/小时
              </Text>
            )}
          </View>
          <View className="expert-card__domains">
            {expert.domains.map((d) => (
              <View key={d} className="expert-card__domain-chip">
                {getDomainLabel(d)}
              </View>
            ))}
          </View>
          <View className="expert-card__rating">
            <View className="expert-card__stars">
              {[1, 2, 3, 4, 5].map((i) => (
                <Text
                  key={i}
                  className={`expert-card__star ${
                    i <= Math.round(expert.avgRating)
                      ? "expert-card__star--filled"
                      : ""
                  }`}
                >
                  ★
                </Text>
              ))}
            </View>
            <Text className="expert-card__review-count">
              {expert.reviewCount} 条评价
            </Text>
          </View>
        </View>
      </View>
      <View className="expert-card__actions">
        <View
          className="expert-card__btn expert-card__btn--primary"
          hoverClass="expert-card__btn--hover"
          onClick={(e) => { e.stopPropagation(); goToBook(); }}
        >
          预约咨询
        </View>
        <View
          className="expert-card__btn expert-card__btn--outline"
          hoverClass="expert-card__btn--hover"
          onClick={(e) => { e.stopPropagation(); goToProfile(); }}
        >
          查看主页
        </View>
      </View>
    </View>
  );
}
