require("dotenv").config();
const cron = require("node-cron");
const Subscription = require("../models/Subscription");
const memberstackAdmin = require("@memberstack/admin");
const logger = require("../config/logger");

const memberstack = memberstackAdmin.init(process.env.SECRET_KEY);

// Запускать каждый день в 00:00 (UTC)
cron.schedule("0 0 * * *", async () => {
  logger.info("Starting expired subscriptions check...");

  try {
    const now = new Date();

    // Находим подписки, которые нужно обработать:
    // - finished: true (подписка отменена)
    // - deleted: false (еще не обработана)
    // - finishDate <= now ИЛИ finishDate не указана
    const expiredSubscriptions = await Subscription.find({
      finished: true,
      deleted: false,
      $or: [
        { finishDate: { $lte: now } },
        { finishDate: { $exists: false } },
        { finishDate: null },
      ],
    });

    logger.info(
      `Found ${expiredSubscriptions.length} expired subscriptions to process`
    );

    for (const subscription of expiredSubscriptions) {
      try {
        logger.info(
          `Processing subscription ${subscription.subscriptionId}...`
        );

        // Пытаемся удалить план через memberId
        try {
          await memberstack.members.removeFreePlan({
            id: subscription.memberId,
            data: {
              planId: subscription.memberstackPlanId,
            },
          });
          logger.info(`Plan removed via memberId`, {
            subscriptionId: subscription.subscriptionId,
            memberId: subscription.memberId,
          });
        } catch (error) {
          logger.warn(`Failed to remove via memberId, trying email...`, {
            subscriptionId: subscription.subscriptionId,
            error: error.message,
          });

          // Если не получилось через memberId, ищем по email
          const member = await memberstack.members.retrieve({
            email: subscription.memberEmail,
          });

          if (member?.data?.id) {
            await memberstack.members.removeFreePlan({
              id: member.data.id,
              data: {
                planId: subscription.memberstackPlanId,
              },
            });
            logger.info(`Plan removed via email`, {
              subscriptionId: subscription.subscriptionId,
              email: subscription.memberEmail,
            });
          } else {
            throw new Error(
              `User not found by email: ${subscription.memberEmail}`
            );
          }
        }

        // Помечаем как обработанную
        subscription.deleted = true;
        await subscription.save();

        logger.info(`Subscription processed successfully`, {
          subscriptionId: subscription.subscriptionId,
        });
      } catch (error) {
        logger.error(`Error processing subscription`, {
          subscriptionId: subscription.subscriptionId,
          error: error.message,
          stack: error.stack,
        });
        // Не ставим deleted: true, чтобы попробовать снова завтра
      }
    }

    logger.info("Expired subscriptions check completed");
  } catch (error) {
    logger.error("Error in cron job", {
      error: error.message,
      stack: error.stack,
    });
  }
});

logger.info(
  "Cron job for removing expired subscriptions initialized (runs daily at 00:00 UTC)"
);
