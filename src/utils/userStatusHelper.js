const User = require('../models/User');
const UserCard = require('../models/UserCard');

const updateUserStatus = async (userId) => {
  try {
    const user = await User.findById(userId);
    if (!user) return;

    const activeCardsCount = await UserCard.countDocuments({ userId, status: 'Active' });
    if (activeCardsCount > 0) {
      if (user.accountStatus !== 'MINER') {
        user.accountStatus = 'MINER';
        await user.save();
      }
      return;
    }

    const totalCardsCount = await UserCard.countDocuments({ userId });
    if (totalCardsCount > 0) {
      if (user.accountStatus !== 'HOLDER') {
        user.accountStatus = 'HOLDER';
        await user.save();
      }
      return;
    }

    const walletUsd = parseFloat(user.balance.walletUsd.toString());
    if (walletUsd > 0) {
      if (user.accountStatus !== 'DEPOSITOR') {
        user.accountStatus = 'DEPOSITOR';
        await user.save();
      }
      return;
    }

    if (user.accountStatus !== 'NEWBIE') {
      user.accountStatus = 'NEWBIE';
      await user.save();
    }

  } catch (error) {
    console.error('Error updating user status:', error);
  }
};

module.exports = { updateUserStatus };